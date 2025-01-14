import Vue from 'vue';
import Vuex from 'vuex';
import VueRx from 'vue-rx';
// @ts-ignore
import VuePursue from 'vue-pursue';

import cloneDeep from 'clone-deep';
import {getStoreBuilder} from 'vuex-typex';

import * as CorpusModule from '@/store/search/corpus';
import * as HistoryModule from '@/store/search/history';
import * as QueryModule from '@/store/search/query';
import * as TagsetModule from '@/store/search/tagset';
import * as UIModule from '@/store/search/ui';

// Form
import * as FormManager from '@/store/search/form';
import * as FilterModule from '@/store/search/form/filters';
import * as InterfaceModule from '@/store/search/form/interface';
import * as PatternModule from '@/store/search/form/patterns';
import * as ExploreModule from '@/store/search/form/explore';
import * as GapModule from '@/store/search/form/gap';

// Results
import * as ResultsManager from '@/store/search/results';
import * as DocResultsModule from '@/store/search/results/docs';
import * as GlobalResultsModule from '@/store/search/results/global';
import * as HitResultsModule from '@/store/search/results/hits';

import * as BLTypes from '@/types/blacklabtypes';
import { getPatternString } from '@/utils';

Vue.use(Vuex);
Vue.use(VueRx);

type RootState = {
	corpus: CorpusModule.ModuleRootState;
	history: HistoryModule.ModuleRootState;
	query: QueryModule.ModuleRootState;
	tagset: TagsetModule.ModuleRootState;
	ui: UIModule.ModuleRootState;
}&FormManager.PartialRootState&ResultsManager.PartialRootState;

const b = getStoreBuilder<RootState>();

const getState = b.state();

const get = {
	viewedResultsSettings: b.read(state => state.interface.viewedResults != null ? state[state.interface.viewedResults] : null, 'getViewedResultsSettings'),

	filtersActive: b.read(state => {
		return !(InterfaceModule.get.form() === 'search' && InterfaceModule.get.patternMode() === 'simple');
	}, 'filtersActive'),
	gapFillingActive: b.read(state => {
		return (InterfaceModule.get.form() === 'search' && InterfaceModule.get.patternMode() === 'expert');
	}, 'gapFillingActive'),
	queryBuilderActive: b.read(state => {
		return InterfaceModule.get.form() === 'search' && InterfaceModule.get.patternMode() === 'advanced';
	}, 'queryBuilderActive'),

	blacklabParameters: b.read((state): BLTypes.BLSearchParameters|undefined => {
		const activeView = get.viewedResultsSettings();
		if (activeView == null) {
			return undefined;
			// throw new Error('Cannot generate blacklab parameters without knowing what kinds of results are being viewed (hits or docs)');
		}

		if (state.query == null) {
			return undefined;
			// throw new Error('Cannot generate blacklab parameters before search form has been submitted');
		}

		if (state.global.sampleSize && state.global.sampleSeed == null) {
			throw new Error('Should provide a sampleSeed when random sampling, or every new page of results will use a different seed');
		}

		return {
			filter: QueryModule.get.filterString(),
			first: state.global.pageSize * activeView.page,
			group: activeView.groupBy.map(g => g + (activeView.caseSensitive ? ':s':':i')).concat(activeView.groupByAdvanced).join(',') || undefined,

			number: state.global.pageSize,
			patt: QueryModule.get.patternString(),
			pattgapdata: (QueryModule.get.patternString() && QueryModule.getState().gap) ? QueryModule.getState().gap!.value || undefined : undefined,

			sample: (state.global.sampleMode === 'percentage' && state.global.sampleSize) ? state.global.sampleSize : undefined,
			samplenum: (state.global.sampleMode === 'count' && state.global.sampleSize) ? state.global.sampleSize : undefined,
			sampleseed: state.global.sampleSize != null ? state.global.sampleSeed! /* non-null precondition checked above */ : undefined,

			sort: activeView.sort != null ? activeView.sort : undefined,
			viewgroup: activeView.viewGroup != null ? activeView.viewGroup : undefined,
			wordsaroundhit: state.global.wordsAroundHit != null ? state.global.wordsAroundHit : undefined,
		};
	}, 'blacklabParameters')
};

const actions = {
	/** Read the form state, build the query, reset the results page/grouping, etc. */
	searchFromSubmit: b.commit(state => {
		if (state.interface.form === 'search' && state.interface.patternMode === 'extended' && state.patterns.extended.splitBatch) {
			// TODO tidy up implementation of split batch queries
			actions.searchSplitBatches();
			return;
		}
		// Reset the grouping/page/sorting/etc
		ResultsManager.actions.resetResults();

		// Apply the desired grouping for this form, if needed.
		if (state.interface.form === 'explore') {
			switch (state.interface.exploreMode) {
				case 'corpora': {
					InterfaceModule.actions.viewedResults('docs');
					DocResultsModule.actions.groupDisplayMode(state.explore.corpora.groupDisplayMode);
					DocResultsModule.actions.groupBy(state.explore.corpora.groupBy ? [state.explore.corpora.groupBy] : []);
					break;
				}
				case 'frequency':
				case 'ngram': {
					InterfaceModule.actions.viewedResults('hits');
					HitResultsModule.actions.groupBy(state.interface.exploreMode === 'ngram' ? [ExploreModule.get.ngram.groupBy()] : [ExploreModule.get.frequency.groupBy()]);
					break;
				}
				default: throw new Error(`Unhandled explore mode ${state.interface.exploreMode} while submitting form`);
			}
		}

		// Open the results, which actually executes the query.
		const oldPattern = QueryModule.get.patternString();
		actions.searchAfterRestore();
		const newPattern = QueryModule.get.patternString();

		let newView = InterfaceModule.get.viewedResults();
		if (newView == null) {
			newView = newPattern ? 'hits' : 'docs';
		} else if (newView === 'hits' && !newPattern) {
			newView = 'docs';
		} else if (oldPattern == null && newPattern != null) {
			newView = 'hits';
		}

		InterfaceModule.actions.viewedResults(newView);
	}, 'searchFromSubmit'),

	/**
	 * Same deal, parse the form and generate the appropriate query, but do not change which, and how results are displayed
	 * This is for when the page is first loaded, the url is decoded and might have contained information about how the results are displayed.
	 * This data is now already in the store, we don't want to clear this.
	 *
	 * NOTE: this does make some assumption that the state shape is valid.
	 * Namely that the groupBy parameter makes sense if the current search mode is ngrams or frequencies.
	 */
	searchAfterRestore: b.commit(state => {
		let submittedFormState: QueryModule.ModuleRootState;

		// jump through some typescript hoops
		const activeForm = InterfaceModule.get.form();
		switch (activeForm) {
			case 'explore': {
				const exploreMode = InterfaceModule.get.exploreMode();
				submittedFormState = {
					form: activeForm,
					subForm: exploreMode,
					// Copy so we don't alias, we should "snapshot" the current form
					// Also cast back into correct type after parsing/stringifying so we don't lose type-safety (parse returns any)
					filters: get.filtersActive() ? cloneDeep(FilterModule.get.activeFiltersMap()) as ReturnType<typeof FilterModule['get']['activeFiltersMap']> : {},
					formState: cloneDeep(ExploreModule.getState()[exploreMode]) as ExploreModule.ModuleRootState[typeof exploreMode],
					gap: get.gapFillingActive() ? GapModule.getState() : GapModule.defaults,
				};
				break;
			}
			case 'search': { // activeForm === 'search'
				const patternMode = InterfaceModule.get.patternMode();
				submittedFormState = {
					form: activeForm,
					subForm: patternMode,
					// Copy so we don't alias the objects, we should "snapshot" the current form
					// Also cast back into correct type after parsing/stringifying so we don't lose type-safety (parse returns any)
					filters: get.filtersActive() ? cloneDeep(FilterModule.get.activeFiltersMap()) as ReturnType<typeof FilterModule['get']['activeFiltersMap']> : {},
					formState: cloneDeep(PatternModule.getState()[patternMode]) as PatternModule.ModuleRootState[typeof patternMode],
					gap: get.gapFillingActive() ? GapModule.getState() : GapModule.defaults,
				};
				break;
			}
			default: {
				throw new Error('Form ' + activeForm + ' cannot generate blacklab query; not implemented!');
			}
		}
		QueryModule.actions.search(submittedFormState);
	}, 'searchFromRestore'),

	/**
	 * TODO: this is ugly code, and heavily relies on knowledge about other parts of the codebase, mostly the history objects - clean it up in some manner.
	 *
	 * Split batch queries: allow batch submission of many cql patterns
	 * Works by splitting OR'ed annotations into individual queries containing just that one value.
	 * So say we have
	 * ```typescript
	 * [{
	 *     id: 'lemma',
	 *     value: 'a|b',
	 *     ...
	 * }, {
	 *     id: 'word',
	 *     value: 'c|d',
	 *     ...
	 * }]
	 * ```
	 * Normally the resulting query would be
	 * ```typescript
	 * - [lemma="a|b" & word="c|d"]
	 * ```
	 * But using split batches, the following 4 queries are generated:
	 * ```typescript
	 * - [lemma = "a"]
	 * - [lemma = "b"]
	 * - [word  = "c"]
	 * - [word  = "d"]
	 * ```
	 * Then the first query in the list is submitted, and the rest is pushed into the history so the user can load them at a later moment.
	 */
	searchSplitBatches: b.commit(state => {
		if (state.interface.form !== 'search' || state.interface.patternMode !== 'extended' || !state.patterns.extended.splitBatch) {
			throw new Error('Attempting to submit split batches in wrong view');
		}

		const sharedBatchState: Pick<HistoryModule.HistoryEntry, Exclude<keyof HistoryModule.HistoryEntry, 'patterns'>> = {
			docs: DocResultsModule.defaults,
			explore: ExploreModule.defaults,
			global: GlobalResultsModule.getState(),
			hits: HitResultsModule.defaults,
			interface: InterfaceModule.getState(),
			filters: get.filtersActive() ? FilterModule.get.activeFiltersMap() : {},
			gap: get.gapFillingActive() ? GapModule.getState() : GapModule.defaults,
		};

		const annotations = PatternModule.get.activeAnnotations();
		const submittedFormStates = annotations
		.filter(a => a.type !== 'pos')
		.flatMap(a => {
			return a.value
			.split('|')
			.map(value => ({
				...a,
				value
			}));
		})
		.map<{
			entry: HistoryModule.HistoryEntry,
			pattern?: string,
			url: string
		}>(a => ({
			entry: {
				...sharedBatchState,
				patterns: {
					advanced: null,
					expert: null,
					simple: {...PatternModule.getState().simple, value: '', case: false},
					extended: {
						annotationValues: {
							[a.id]: a
						},
						splitBatch: false,
						within: state.patterns.extended.within
					}
				}
			},
			pattern: getPatternString([a], state.patterns.extended.within),
			// TODO :( url generation is too encapsulated to completely repro here
			url: ''
		}))
		// remove vuex listeners from aliased parts of the store.
		.map(v => cloneDeep(v));

		// We can't just run a submit for every subquery, as that would be REALLY slow.
		// Even if it were fast, mutations within a single vue frame are debounced,
		// so listeners won't be called for any update except the last,
		// preventing the history entries from being created.
		// Unfortunately we need to copy the history entry generation code :(
		// See streams.ts

		submittedFormStates.forEach(HistoryModule.actions.addEntry);
		const mostRecent = HistoryModule.getState()[0];
		if (mostRecent) {
			actions.replace(mostRecent);
		}
	}, 'searchSplitBatches'),

	reset: b.commit(state => {
		FormManager.actions.reset();
		ResultsManager.actions.resetResults();
		QueryModule.actions.reset();
	}, 'resetRoot'),

	replace: b.commit((state, payload: HistoryModule.HistoryEntry) => {
		FormManager.actions.replace(payload);
		ResultsManager.actions.replace(payload);

		// The state we just restored has results open, so execute a search.
		if (payload.interface.viewedResults != null) {
			actions.searchAfterRestore();
		}
	}, 'replaceRoot'),
};

// NOTE: only call this after creating all getters and actions etc.
// NOTE: process.env is empty at runtime, but webpack inlines all values at compile time, so this check works.
declare const process: any;
const store = b.vuexStore({
	state: {} as RootState, // shut up typescript, the state we pass here is merged with the modules initial states internally.
	strict: process.env.NODE_ENV === 'development',
	plugins: process.env.NODE_ENV === 'development' ? [VuePursue] : undefined
});

const init = () => {
	// Load the corpus data, so we can derive values, fallbacks and defaults in the following modules
	// This must happen right at the beginning of the app startup
	CorpusModule.init();
	// This is user-customizable data, it can be used to override various defaults from other modules,
	// It needs to determine fallbacks and defaults for settings that haven't been configured,
	// So initialize it before the other modules.
	UIModule.init();

	FormManager.init();
	ResultsManager.init();

	TagsetModule.init();
	HistoryModule.init();
	QueryModule.init();
};

// Debugging helpers.
(window as any).vuexModules = {
	root: {
		store,
		getState,
		get,
		actions,
		init
	},

	corpus: CorpusModule,
	history: HistoryModule,
	query: QueryModule,
	tagset: TagsetModule,
	ui: UIModule,

	explore: ExploreModule,
	form: FormManager,
	filters: FilterModule,
	interface: InterfaceModule,
	patterns: PatternModule,
	gap: GapModule,

	results: ResultsManager,
	docs: DocResultsModule,
	hits: HitResultsModule,
	global: GlobalResultsModule,
};

(window as any).vuexStore = store;

export {
	RootState,

	store,
	getState,
	get,
	actions,
	init,
};
