import URI from 'urijs';
import memoize from 'memoize-decorator';

import {makeRegexWildcard, unescapeLucene} from '@/utils';
import parseCql, {Attribute} from '@/utils/cqlparser';
import parseLucene from '@/utils/luceneparser';
import {debugLog} from '@/utils/debug';

import * as CorpusModule from '@/store/corpus';
import * as HistoryModule from '@/store/history';
import * as TagsetModule from '@/store/tagset';

// Form
import * as FilterModule from '@/store/form/filters';
import * as InterfaceModule from '@/store/form/interface';
import * as PatternModule from '@/store/form/patterns';
import * as ExploreModule from '@/store/form/explore';

// Results
import * as ResultsManager from '@/store/results';
import * as DocResultsModule from '@/store/results/docs';
import * as GlobalResultsModule from '@/store/results/global';
import * as HitResultsModule from '@/store/results/hits';

import {FilterValue, AnnotationValue} from '@/types/apptypes';

/**
 * Decode the current url into a valid page state configuration.
 * Keep everything private except the getters
 */
export default class UrlStateParser {
	/**
	 * Path segments of the url this was constructed with, typically something like ['corpus-frontend', ${corpus.id}, ('search'), ('docs'|'hits')]
	 * But might contain extra leading segments if the application is proxied.
	 */
	private paths: string[];
	/** Query parameters parsed into an object, repeated fields are turned into an array, though all values are kept as-is as strings */
	private params: {[key: string]: string|string[]|null};

	constructor(uri = new URI()) {
		this.paths = uri.segmentCoded();
		this.params = uri.search(true) || {};
	}

	@memoize
	public get(): HistoryModule.HistoryEntry {
		return {
			explore: this.explore,
			filters: this.filters,
			interface: this.interface,
			patterns: this.patterns,

			docs: this.docs,
			global: this.global,
			hits: this.hits,

			// submitted query not parsed from url: is restored from rest of state later.
		};
	}

	@memoize
	private get explore(): ExploreModule.ModuleRootState {
		return {
			frequency: this.frequencies || ExploreModule.defaults.frequency,
			ngram: this.ngrams || ExploreModule.defaults.ngram
		};
	}

	@memoize
	private get filters(): FilterModule.ModuleRootState {
		const luceneString = this.getString('filter', null, v=>v?v:null);
		if (luceneString == null) {
			return {};
		}
		try {
			const supportedMetadataFields = CorpusModule.getState().metadataFields;

			return parseLucene(luceneString)
			.filter(metadataField => supportedMetadataFields.hasOwnProperty(metadataField.id))
			.map(metadataField => {
				const actualField = supportedMetadataFields[metadataField.id];
				metadataField.type = actualField.uiType;
				switch (actualField.uiType) {
					case 'text':
					case 'combobox': {
						// See utils::getFilterString
						// types that allow the user to type their own value have special lucene characters escaped.
						// But only when the value does not contain any whitespace (as values with whitespace need to be surrounded by quotes, which already escapes all special characters)
						// So we need to reverse this escaping here.
						metadataField.values = metadataField.values.map(v => v.match(/\s+/) ? v : unescapeLucene(v));
						break;
					}
					case 'checkbox':
					case 'radio':
					case 'range':
					case 'select':
						// the user can't enter custom values here, so nothing to do.
						break;
					default:
						// This should never happen unless new uiTypes are added
						// in which case, maybe the values need to be handled in a special way
						throw new Error('Unimplemented value deserializing for metadata filter uiType ' + actualField.uiType);
				}
				return metadataField;
			})
			.reduce((acc, v) => {
				acc[v.id] = v;
				return acc;
			}, {} as {[key: string]: FilterValue});
		} catch (error) {
			debugLog('Cannot decode lucene query ', luceneString, error);
			return {};
		}
	}

	/**
	 * Return the frequency form state, if the query fits in there in its entirity.
	 * Null is returned otherwise.
	 */
	@memoize
	private get frequencies(): null|ExploreModule.ModuleRootState['frequency'] {
		if (this.expertPattern !== '[]' || this._groups.length !== 1 || this.groupBy.length !== 1) {
			return null;
		}

		const group = this.groupBy[0];
		if (!group.startsWith('hit:')) {
			return null;
		}

		const annotationId = group.substring(4);
		if (!CorpusModule.get.annotationDisplayNames().hasOwnProperty(annotationId)) {
			return null;
		}

		return { annotationId };
	}

	@memoize
	private get interface(): InterfaceModule.ModuleRootState {
		try {
			const uiStateFromUrl: Partial<InterfaceModule.ModuleRootState>|null = JSON.parse(this.getString('interface', null, v => v.startsWith('{')?v:null)!);
			if (!uiStateFromUrl) {
				throw new Error('No url ui state, falling back to determining from rest of parameters.');
			}
			return {
				...InterfaceModule.defaults,
				...uiStateFromUrl,
				// This is not contained in the 'interface' query parameters, but in the path segments of the url.
				// hence decode seperately.
				viewedResults: this.viewedResults
			};
		} catch (e) {
			// Can't parse from url, instead determine the best state based on other parameters.
			const ui = InterfaceModule.defaults;

			// show the pattern view that can hold the query
			// the other views will have the query placed in it as well (if it fits), but this is more of a courtesy
			// if no pattern exists, show the simplest search
			const hasFilters = Object.keys(this.filters).length > 0;
			let fromPattern = true; // is interface state actually from the pattern, or from the default fallback?
			if (this.simplePattern && !hasFilters) {
				ui.patternMode = 'simple';
			} else if ((Object.keys(this.extendedPattern.annotationValues).length > 0)) {
				ui.patternMode = 'extended';
			} else if (this.advancedPattern) {
				ui.patternMode = 'advanced';
			} else if (this.expertPattern) {
				ui.patternMode = 'expert';
			} else {
				ui.patternMode = hasFilters ? 'extended' : 'simple';
				fromPattern = false;
			}

			// Open any results immediately?
			ui.viewedResults = this.viewedResults;

			// Explore forms have priority over normal search form
			if (this.frequencies != null) {
				ui.form = 'explore';
				ui.exploreMode = 'frequency';
			} else if (this.ngrams != null && !(fromPattern && ui.patternMode === 'simple')) {
				ui.form = 'explore';
				ui.exploreMode = 'ngram';
			}

			return ui;
		}
	}

	@memoize
	private get viewedResults(): 'hits'|'docs'|null {
		const path = this.paths.length ? this.paths[this.paths.length-1].toLowerCase() : null;
		if (path !== 'hits' && path !== 'docs') {
			return null;
		} else {
			return path;
		}
	}

	/**
	 * Return the ngram form state, if the query fits in there in its entirity.
	 * Null is returned otherwise.
	 */
	@memoize
	private get ngrams(): null|ExploreModule.ModuleRootState['ngram'] {
		if (this.groupByAdvanced.length || this.groupBy.length === 0) {
			return null;
		}

		const group = this.groupBy[0];
		if (!group.startsWith('hit:')) {
			return null;
		}

		const annotationId = group.substring(4);
		if (!CorpusModule.get.annotationDisplayNames().hasOwnProperty(annotationId)) {
			return null;
		}

		const cql = this._parsedCql;
		if ( // all tokens need to be very simple [annotation="value"] tokens.
			!cql ||
			cql.within ||
			cql.tokens.length > ExploreModule.defaults.ngram.maxSize ||
			cql.tokens.find(t =>
				t.leadingXmlTag != null ||
				t.trailingXmlTag != null ||
				t.repeats != null ||
				t.optional ||
				(t.expression != null && (t.expression.type !== 'attribute' || t.expression.operator !== '='))
			) != null
		) {
			return null;
		}

		// Alright, seems we're all good.
		return {
			groupAnnotationId: annotationId,
			maxSize: ExploreModule.defaults.ngram.maxSize,
			size: cql.tokens.length,
			tokens: cql.tokens.map(t => ({
				id: t.expression ? (t.expression as Attribute).name : CorpusModule.get.firstMainAnnotation().id,
				value: t.expression ? makeRegexWildcard((t.expression as Attribute).value) : '',
			})),
		};
	}

	@memoize
	private get patterns(): PatternModule.ModuleRootState {
		return {
			simple: this.simplePattern,
			extended: this.extendedPattern,
			advanced: this.advancedPattern,
			expert: this.expertPattern,
		};
	}

	private get hits(): HitResultsModule.ModuleRootState {
		return this.hitsOrDocs('hits');
	}

	private get docs(): DocResultsModule.ModuleRootState {
		return this.hitsOrDocs('docs');
	}

	@memoize
	private get global(): GlobalResultsModule.ModuleRootState {
		return {
			pageSize: this.pageSize,
			sampleMode: this.sampleMode,
			sampleSeed: this.sampleSeed,
			sampleSize: this.sampleSize,
			wordsAroundHit: this.wordsAroundHit
		};
	}

	@memoize
	private get pageSize(): number {
		return this.getNumber('number', GlobalResultsModule.defaults.pageSize, v => [20,50,100,200].includes(v) ? v : GlobalResultsModule.defaults.pageSize)!;
	}

	@memoize
	private get annotationValues(): {[key: string]: AnnotationValue} {
		function isCase(value: string) { return value.startsWith('(?-i)') || value.startsWith('(?c)'); }
		function stripCase(value: string) { return value.substr(value.startsWith('(?-i)') ? 5 : 4); }

		// How we parse the cql pattern depends on whether a tagset is available for this corpus, and whether it's enabled in the ui
		if (!(TagsetModule.getState().state === 'loaded' || TagsetModule.getState().state === 'disabled')) {
			throw new Error('Attempting to parse url before tagset is loaded or disabled, await tagset.awaitInit() before parsing url.');
		}

		const result = this._parsedCql;
		if (result == null) {
			return {};
		}

		const tagsetInfo = TagsetModule.getState().state === 'loaded' ? {
			mainAnnotations: CorpusModule.get.annotations().filter(a => a.uiType === 'pos').map(a => a.id),
			subAnnotations: Object.keys(TagsetModule.getState().subAnnotations)
		} : null;

		try {
			/**
			 * A requirement of the PropertyFields is that there are no gaps in the values
			 * So a valid config is
			 * ```
			 * lemma: [these, are, words]
			 * word: [these, are, other, words]
			 * ```
			 * And an invalid config is
			 * ```
			 * lemma: [gaps, are, , not, allowed]
			 * ```
			 * Not all properties need to have the same number of values though,
			 * shorter lists are implicitly treated as having wildcards for the remainder of values. (see getPatternString())
			 *
			 * Store the values here while parsing.
			 */
			const knownAnnotations = CorpusModule.get.annotationDisplayNames();

			const annotationValues: {[key: string]: string[]} = {};
			for (let i = 0; i < result.tokens.length; ++i) {
				const token = result.tokens[i];
				if (token.leadingXmlTag || token.optional || token.repeats || token.trailingXmlTag) {
					throw new Error('Token contains settings too complex for simple search');
				}

				// Use a stack instead of direct recursion to simplify code
				const stack = token.expression ? [token.expression] : [];
				while (stack.length) {
					const expr = stack.shift()!;
					if (expr.type === 'attribute') {
						const name = expr.name;
						if (knownAnnotations[name] == null) {
							debugLog(`Encountered unknown cql field ${name} while decoding query from url, ignoring.`);
							continue;
						}

						const isMainTagsetAnnotation = tagsetInfo && tagsetInfo.mainAnnotations.includes(name);
						const isTagsetAnnotation = isMainTagsetAnnotation || (tagsetInfo && tagsetInfo.subAnnotations.includes(name));

						if (isTagsetAnnotation) {
							// add value as original cql-query substring to the main tagset annotation under which the values should be stored.
							debugLog('Relocating value for annotation ' + name + ' to tagset annotation(s) ' + tagsetInfo!.mainAnnotations);
							const originalValue = `${name}="${expr.value}"`;

							for (const id of tagsetInfo!.mainAnnotations) {
								const valuesForAnnotation = annotationValues[id] = annotationValues[id] || [];
								// keep main annotation at the start
								isMainTagsetAnnotation ? valuesForAnnotation.unshift(originalValue) : valuesForAnnotation.push(originalValue);
							}
						} else {
							// otherwise just store wherever it should be in the store.
							const values = annotationValues[name] = annotationValues[name] || [];
							if (expr.operator !== '=') {
								throw new Error(`Unsupported comparator for property ${name} on token ${i} for query ${this.expertPattern}, only "=" is supported.`);
							}
							if (values.length !== i) {
								throw new Error(`Property ${name} contains gaps in value for query ${this.expertPattern}`);
							}
							values.push(expr.value);
						}

					} else if (expr.type === 'binaryOp') {
						if (!(expr.operator === '&' || expr.operator === 'AND')) {
							throw new Error(`Properties on token ${i} are combined using unsupported operator ${expr.operator} in query ${this.expertPattern}, only AND/& operator is supported.`);
						}

						stack.push(expr.left, expr.right);
					}
				}
			}

			/**
			 * Build the actual PropertyFields.
			 * Convert from regex back into pattern globs, extract case sensitivity.
			 */
			return Object.entries(annotationValues).map<AnnotationValue>(([id, values]) => {
				if (tagsetInfo && tagsetInfo.mainAnnotations.includes(id)) {
					// use value as-is, already contains cql and should not have wildcards substituted.
					debugLog('Mapping tagset annotation back to cql: ' + id + ' with values ' + values);

					return {
						id,
						case: false,
						value: values.join('&'),
					};
				}

				const caseSensitive = values.every(isCase);
				if (caseSensitive) {
					values = values.map(stripCase);
				}
				return {
					id,
					case: caseSensitive,
					value: makeRegexWildcard(values.join(' '))
				} as AnnotationValue;
			})
			.reduce((acc, v) => {acc[v.id] = v; return acc;}, {} as {[key: string]: AnnotationValue});
		} catch (error) {
			debugLog('Cql query could not be placed in extended view', error);
			return {};
		}
	}

	@memoize
	private get simplePattern(): string|null {
		// Simple view is just a subset of extended view
		// So we can just check if extended fits into simple
		// then we get wildcard conversion etc for free.
		// (simple/extended view have their values processed when converting to query - see utils::getPatternString,
		// and this needs to be undone too)
		const extended = this.extendedPattern;
		const vals = Object.values(this.extendedPattern.annotationValues);
		if (extended.within == null && vals.length === 1 && vals[0].id === CorpusModule.get.firstMainAnnotation().id && !vals[0].case) {
			return vals[0].value;
		}

		return null;
	}

	@memoize
	private get extendedPattern() {
		return {
			annotationValues: this.annotationValues,
			within: this.within
		};
	}

	@memoize
	private get advancedPattern(): string|null {
		// If the pattern can't be parsed, the querybuilder can't use it either.
		return this._parsedCql ? this.expertPattern : null;
	}

	@memoize
	private get expertPattern(): string|null {
		return this.getString('patt', null, v=>v?v:null);
	}

	@memoize
	private get sampleMode(): 'count'|'percentage' {
		// If 'sample' exists we're in count mode, otherwise if 'samplenum' (and is valid), we're in percent mode
		// ('sample' also has precendence for the purposes of determining samplesize)
		if (this.getNumber('samplenum') != null) {
			return 'count';
		} else if (this.getNumber('sample', null, v => (v != null && (v >= 0 && v <=100)) ? v : null) != null) {
			return 'percentage';
		} else {
			return GlobalResultsModule.defaults.sampleMode;
		}
	}

	@memoize
	private get sampleSeed(): number|null {
		return this.getNumber('sampleseed', null);
	}

	@memoize
	private get sampleSize(): number|null {
		// Use 'sample' unless missing or not 0-100 (as it's percentage-based), then use 'samplenum'
		const sample = this.getNumber('sample', null, v => v != null && v >= 0 && v <= 100 ? v : null);
		return sample != null ? sample : this.getNumber('samplenum', null);
	}

	// TODO these might become dynamic in the future, then we need extra manual checking to see if the value is even supported in this corpus
	@memoize
	private get within(): string|null {
		return this._parsedCql ? this._parsedCql.within || null : null;
	}

	@memoize
	private get wordsAroundHit(): number|null {
		return this.getNumber('wordsaroundhit', null, v => v != null && v >= 0 && v <= 10 ? v : null);
	}

	/** Return the group variables unprocessed, including their case flags and context groups intact */
	@memoize
	private get _groups(): string[] {
		return this.getString('group', '')!
		.split(',')
		.map(g => g.trim())
		.filter(g => !!g);
	}

	@memoize
	private get groupBy(): string[] {
		return this._groups
		.filter(g => !g.startsWith('context:'))
		.map(g => g.replace(/\:[is]$/, '')); // strip case-sensitivity flag from value, is only visible in url
	}

	@memoize
	private get groupByAdvanced(): string[] {
		return this._groups
		.filter(g => g.startsWith('context:'));
	}

	@memoize
	private get caseSensitive(): boolean {
		const groups = this._groups
		.filter(g => !g.startsWith('context:'));

		return groups.length > 0 && groups.every(g => g.endsWith(':s'));
	}

	// No memoize - has parameters
	private hitsOrDocs(view: ResultsManager.ViewId): DocResultsModule.ModuleRootState { // they're the same anyway.
		if (this.viewedResults !== view) {
			return DocResultsModule.defaults;
		}

		return {
			groupBy: this.groupBy,
			groupByAdvanced: this.groupByAdvanced,
			caseSensitive: this.caseSensitive,
			sort: this.getString('sort', null, v => v?v:null),
			viewGroup: this.getString('viewgroup', undefined, v => (v && this._groups.length > 0)?v:null),
			page: this.getNumber('first', 0, v => Math.floor(Math.max(0, v)/this.pageSize)/* round down to nearest page containing the starting index */)!,
		};
	}

	// ------------------------
	// Some intermediate values
	// ------------------------

	@memoize
	private get _parsedCql(): null|ReturnType<typeof parseCql> {
		try {
			const result = parseCql(this.expertPattern || '', CorpusModule.get.firstMainAnnotation().id);
			return result.tokens.length > 0 ? result : null;
		} catch (e) {
			return null; // meh, can't parse
		}
	}

	/**
	 * Get the parameter by the name of paramname from our query parameters.
	 * If the parameter is missing or is NaN, the fallback will be returned,
	 * otherwise, the parameter is passed to the validate function (if present), and the result is returned.
	 */
	private getNumber(paramname: string, fallback: number|null = null, validate?: (value: number)=>number|null): number|null {
		const {[paramname]: prop} = this.params;
		if (typeof prop !== 'string') {
			return fallback;
		}
		const val = Number.parseInt(prop, 10);
		if (isNaN(val)) {
			return fallback;
		}
		return validate ? validate(val) : val;
	}
	/**
	 * Get the parameter by the name of paramname from our query parameters.
	 * If the parameter is missing, the fallback will be returned,
	 * otherwise, the parameter is passed to the validate function (if present), and the result is returned.
	 * NOTE: empty strings are preserved and need to removed using the validation function if needed.
	 */
	private getString(paramname: string, fallback: string|null = null, validate?: (value: string)=>string|null): string|null {
		const {[paramname]: prop} = this.params;
		if (typeof prop !== 'string') {
			return fallback;
		}
		return validate ? validate(prop) : prop;
	}
	/** If the property is missing altogether or can't be parsed, fallback is returned, otherwise the value is parsed */
	private getBoolean(paramname: string, fallback: boolean|null = null, validate?: (value: boolean)=>boolean): boolean|null {
		const {[paramname]: prop} = this.params;
		if (typeof prop !== 'string') {
			return fallback;
		}

		// Present but no value (&prop) === null --> true
		// Present with value --> parse
		if (prop === null) {
			return true;
		} else if (['true', 'yes', 'on', 'enable', 'enabled'].includes(prop.toLowerCase())) {
			return true;
		} else if (['', 'false', 'no', 'off', 'disable', 'disabled'].includes(prop.toLowerCase())) {
			return false;
		} else {
			return fallback;
		}
	}
}