// class CorpusSearch
//----------------------------------------------------------------

var BLS = {};

// moved to single.vm
// var BLS_URL = "http://localhost:8080/blacklab-server/gysseling/";

(function() {
	
	// We increment this with each query, and use it to determine if
	// we should keep updating totals for a query, or if a new query
	// has been started and we shouldn't update the totals for the
	// previous one anymore.
	var currentQueryNumber = 0;

	BLS.search = function(param, successFunc, errorFunc) {
		
		if (!errorFunc)
			errorFunc = SINGLEPAGE.showBlsError;

		function filterQuery(name, value) {
			// TODO: escape double quotes in values with \
			if ($("#" + name + "-select").length > 0) {
				// Multiselect. Quote values and replace glue characters with
				// spaces.
				var values = SINGLEPAGE.safeSplit(value)
				if (values.length > 1)
					return name + ":(\"" + values.join("\" \"") + "\")";
			}
			if (value.match(/ /) && !value.match(/\[\d+ TO \d+\]/)) {
				var words = value.split(/\s+/);
				return name + ":(\"" + words.join("\" \"") + "\")";
			} else
				return name + ":\"" + value + "\"";
		}

		function getPattern(wordProp) {
			var tokens = [];
			for (key in wordProp) {
				if (wordProp.hasOwnProperty(key)) {
					var propTokens = wordProp[key].split(/\s+/);
					for (var i = 0; i < propTokens.length; i++) {
						if (!tokens[i])
							tokens[i] = {};
						if (propTokens[i] == "*" || propTokens[i] == ".*"
								|| propTokens[i] == "[]")
							continue;
						tokens[i][key] = propTokens[i];
					}
				}
			}
			var cql = "";
			for (var i = 0; i < tokens.length; i++) {
				var token = "";
				var wordOnly = true;
				var word = "";
				for (key in tokens[i]) {
					if (tokens[i].hasOwnProperty(key)) {
						if (token.length > 0)
							token += " & "
						token += key + "=\"" + tokens[i][key] + "\"";
						if (key != "word")
							wordOnly = false;
						else
							word = tokens[i][key];
					}
				}
				if (cql.length > 0)
					cql += " ";
				if (token.length > 0) {
					if (wordOnly && word.length > 0)
						cql += "\"" + word + "\"";
					else
						cql += "[" + token + "]"
				} else {
					cql += "[]";
				}
			}
			return cql;
		}

		var blsParam = {
			"number" : 50 // default value
		};
		var filter = "";
		var wordProp = {};
		var operation = "hits";
		for (key in param) {
			if (param.hasOwnProperty(key)) {
				var value = param[key];
				if (key == "view" && value == "docs") {
					operation = "docs";
				} else if (key.charAt(0) == '_') {
					// Metadata. Translate to BLS syntax.
					if (filter.length > 0)
						filter += " ";
					filter += "+" + filterQuery(key.substr(1), value);
				} else if ($("#" + key + "_text").length > 0) {
					// Word property. Use to construct BLS pattern later.
					wordProp[key] = value;
				} else {
					// Something else. For now, assume we can just pass it to
					// BLS.
					blsParam[key] = value;
				}
			}
		}
		var patt = getPattern(wordProp);
		if (patt.length > 0)
			blsParam["patt"] = patt;

		if (!blsParam["patt"] || blsParam["patt"].length == 0) {
			/*if (filter.length == 0) {
				errorFunc({
					"code" : "NO_PATTERN_GIVEN ",
					"message" : "Please specify a text pattern or metadata value(s)."
				});
				return;
			}*/
			operation = "docs";
		}
		if (filter.length > 0)
			blsParam["filter"] = filter;

		var url = "", totalsUrl = "";
		for (key in blsParam) {
			if (blsParam.hasOwnProperty(key)) {
				var value = blsParam[key];
				if (url.length > 0)
					url += "&";
				url += key + "=" + encodeURIComponent(value);
				
				// Totals URL: same, but with number=0
				if (key == "number")
					value = 0; 
				if (totalsUrl.length > 0)
					totalsUrl += "&";
				totalsUrl += key + "=" + encodeURIComponent(value);
			}
		}
		url = operation + "?" + url;
		totalsUrl = operation + "?" + totalsUrl;
		// $("#debugInfo").html("BLS/" + url);
		
		// Remember our query number. As long as our query number
		// is equal to the current query number, keep updating totals
		// for this query.
		currentQueryNumber++;
		var queryNumber = currentQueryNumber;
		
		function updateHitCount(data) {
			if (queryNumber != currentQueryNumber) {
				// The next query has been started. Stop updating
				// totals for this query.
				return;
			}
			
			// Update the totals
			var stillCounting = data.summary.stillCounting;
			var optEllipsis = stillCounting ? "..." : "";
			if (data.hits) {
				SINGLEPAGE.totalPages = Math.ceil(data.summary.numberOfHitsRetrieved / SINGLEPAGE.resultsPerPage);
				$("#totalsReport").show();
				$("#totalsReportText").html(
					"Total hits: " + data.summary.numberOfHits + optEllipsis + "<br/>" +
					"Total pages: " + SINGLEPAGE.totalPages + optEllipsis
				);
			} else if (data.docs) {
				SINGLEPAGE.totalPages = Math.ceil(data.summary.numberOfDocsRetrieved / SINGLEPAGE.resultsPerPage);
				$("#totalsReport").show();
				$("#totalsReportText").html(
					"Total docs: " + data.summary.numberOfDocs + optEllipsis + "<br/>" +
					"Total pages: " + SINGLEPAGE.totalPages + optEllipsis
				);
			} else {
				return;
			}
			
			// All hits/docs counted?
			$("#totalsSpinner").toggle(stillCounting);
			if (stillCounting) {
				// No, keep checking and updating.
				function onAbortQuery() {
					$("#totalsReportText").html("Too busy; counting aborted. Please try again later.");
				}
				
				setTimeout(function () {
					performAjaxSearchRequest(totalsUrl, null, false, onAbortQuery);
				}, 1000);
			}
		}
		
		// Called to perform the search, update the
		// total count, and call a success function.
		function performAjaxSearchRequest(url, successFunc, cache, unavailableHandler) {
			$.ajax({
				url : BLS_URL + url,
				dataType: "json",
				cache: !!cache,
				success: function (response) {
					if (response.hits || response.docs) {
						// Update the total hits/docs count and
						// keep updating it until all hits have been
						// counted.
						updateHitCount(response);
					}
					if (successFunc)
						successFunc(response);
				},
				error: function (jqXHR, textStatus, errorThrown) {
					var data = jqXHR.responseJSON;
					if (data && data.error) {
						if (data.error.code == "SERVER_BUSY" && unavailableHandler) {
							unavailableHandler();
						} else {
							errorFunc(data.error);
						}
					} else {
						errorFunc({
							"code" : "WEBSERVICE_ERROR",
							"message" : "Error contacting webservice: "
									+ textStatus + "; " + errorThrown
						});
					}
				}
			});
		}
		
		// Perform the actual search
		performAjaxSearchRequest(url, successFunc);
		
	};

})();
