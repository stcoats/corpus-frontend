import 'bootstrap';
import 'bootstrap-select';
import 'bootstrap-select/dist/css/bootstrap-select.css';

import $ from 'jquery';
import Vue from 'vue';

// @ts-ignore
import VTooltip from 'v-tooltip';

import {QueryBuilder} from '@/modules/cql_querybuilder';
import {store, init as initStore, UrlPageState} from '@/store';
import {debugLog} from '@/utils/debug';
import {normalizeIndex} from '@/utils/blacklabutils';

import connectVuexToPage from '@/pages/search/vuexbridge';
import connectStreamsToVuex from '@/store/streams';

import SearchPageComponent from '@/pages/search/SearchPage.vue';

import * as AppTypes from '@/types/apptypes';
import * as BLTypes from '@/types/blacklabtypes';

import '@/global.scss';

declare const SINGLEPAGE: {INDEX: BLTypes.BLIndexMetadata};

const connectJqueryToPage = () => {
	debugLog('begin initializing querybuilder and stuff');

	if (window.localStorage) {
		$('input[data-persistent][id != ""]').each(function(i, elem) {
			const $this = $(elem);
			const key = 'input_' + $this.attr('id');
			$this.on('change', function() {
				const curVal: any = $this.is(':checkbox') ? $this.is(':checked') : $this.val();
				window.localStorage.setItem(key, curVal);
			});

			const storedVal = window.localStorage.getItem(key);
			if (storedVal != null) {
				$this.is(':checkbox') ? $this.attr('checked', (storedVal.toLowerCase() === 'true') as any) : $this.val(storedVal);
			}

			// run handler once, init localstorage if required
			// Only do next tick so handlers have a change to register
			setTimeout(function() { $this.trigger('change'); });
		});
	}

	// Init the querybuilder with the supported attributes/properties
	const queryBuilder = new QueryBuilder($('#querybuilder'), {
		attribute: {
			view: {
				// Pass the available properties of tokens in this corpus (PoS, Lemma, Word, etc..) to the querybuilder
				attributes: $.map(BLTypes.isIndexMetadataV1(SINGLEPAGE.INDEX) ? SINGLEPAGE.INDEX.complexFields : SINGLEPAGE.INDEX.annotatedFields, function(annotatedField/*, annotatedFieldName*/) {
					return $.map(BLTypes.isAnnotatedFieldV1(annotatedField) ? annotatedField.properties : annotatedField.annotations, function(property, propertyId: string) {
						if (property.isInternal) {
							return null;
						} // Don't show internal fields in the queryBuilder; leave this out of the list.

						// Transform the supported values to the querybuilder format
						return {
							attribute: propertyId,
							label: property.displayName || propertyId,
							caseSensitive: (property.sensitivity === 'SENSITIVE_AND_INSENSITIVE')
						};
					});
				}),
			}
		}
	});

	// Enable wide view toggle
	$('#wide-view').on('change', function() {
		$('.container, .container-fluid').toggleClass('container', !$(this).is(':checked')).toggleClass('container-fluid', $(this).is(':checked'));
	});

	// TODO just set the new query in state? the commit probably needs to be async and cancelable/failable...
	// Attempt to parse the query from the cql editor into the querybuilder
	// when the user asks to
	$('#parseQuery').on('click', function() {
		const pattern = $('#querybox').val() as string;
		if (queryBuilder.parse(pattern)) {
			$('#searchTabs a[href="#advanced"]').tab('show');
			$('#parseQueryError').hide();
		} else {
			$('#parseQueryError').show();
			$('#querybox').val(pattern);
		}
	});
};

// --------------
// Initialize vue
// --------------
Vue.use(VTooltip);

$(document).ready(() => {
	const normalizedIndex: AppTypes.NormalizedIndex = normalizeIndex(SINGLEPAGE.INDEX);
	const stateFromUrl = new UrlPageState().get();

	initStore(normalizedIndex, stateFromUrl);
	connectStreamsToVuex();

	Vue.config.productionTip = false;

	new Vue({
		store,
		render: h => h(SearchPageComponent),
		mounted() {
			connectJqueryToPage();
			connectVuexToPage();
		}
	}).$mount(document.querySelector('#vue-root')!);
});