// ajax_retriever.js: Send request to backend, transform results with XSLT and update page. 

// NB can be removed when we go fully single-page.

var BLSEARCH;

(function() {
	
	// Shortcuts
	var DEBUG = BLSEARCH.DEBUG;
	var SEARCHPAGE = BLSEARCH.SEARCHPAGE;
	
	// Constructor: takes the base URL and the operation we want to carry out
	SEARCHPAGE.AjaxRetriever = function (webservice, webcall) {
		this.webservice = webservice;
		this.webcall = webcall;
	};
	var AjaxRetriever = SEARCHPAGE.AjaxRetriever;
	
	// Perform AJAX call, transform response XML to HTML and add to the page
	AjaxRetriever.prototype.putAjaxResponse = function(element_id, parameters, append, xslSheet) {
		var myself = this;
	
		// check status
		DEBUG.logAjaxCall(this.webservice + this.webcall, parameters);
		$.ajax({
	        type: "GET",
	        dataType: "xml",
	        url: this.webservice + this.webcall, 
	        data: parameters, 
	        cache: false
	    }).done(function(data) {
			myself.addResponseToElement(data, element_id, append, xslSheet);
		}).fail(function(jqXHR, textStatus) {
			var message = textStatus;
			var data = jqXHR.responseXML;
			var errorElements = data ? $(data).find("error") : null; 
			if (errorElements && errorElements.length > 0) {
	    		message = errorElements.find("message").text();
			}
			DEBUG.showAjaxFail(jqXHR, message, element_id);
		});
	};
	
	// Transform response XML and add to / replace element content
	AjaxRetriever.prototype.addResponseToElement = function(xmlResponse, element_id, append, xslSheetUrl) {
		this.loadXslSheet(xslSheetUrl, function (xslSheet) {
			var html = transformToHtmlText(xmlResponse, xslSheet);
			if(!append)
				$(element_id).html('');
			$(element_id).append(html);	
		});
	};
	
	// FROM: http://stackoverflow.com/questions/12149410/object-doesnt-support-property-or-method-transformnode-in-internet-explorer-1
	// (By Stack Overflow user "The Alpha", License: CC-BY-SA 3.0)
	function transformToHtmlText(xmlDoc, xsltDoc) {
	    if (typeof (XSLTProcessor) != "undefined") { // FF, Safari, Chrome etc
	        var xsltProcessor = new XSLTProcessor();
	        xsltProcessor.importStylesheet(xsltDoc);
	        var xmlFragment = xsltProcessor.transformToFragment(xmlDoc, document);
	        return xmlFragment;
	    }
	
	    if (typeof (xmlDoc.transformNode) != "undefined") { // IE6, IE7, IE8
	        return xmlDoc.transformNode(xsltDoc);
	    }
	    else {
	        try { // IE9 and greater
	        	// Disabled check because IE11 reports ActiveXObject as undefined
	        	// (but we still need it to do client-side XSLT..)
	            //if (window.ActiveXObject) {
	                var xslt = new ActiveXObject("Msxml2.XSLTemplate");
	                var xslDoc = new ActiveXObject("Msxml2.FreeThreadedDOMDocument");
	                xslDoc.loadXML(xsltDoc.xml);
	                xslt.stylesheet = xslDoc;
	                var xslProc = xslt.createProcessor();
	                xslProc.input = xmlDoc;
	                xslProc.transform();
	                return xslProc.output;
	            //}
	        }
	        catch (e) {
	        	alert("Exception while doing XSLT transform: " + e.message);
	            //alert("The type [XSLTProcessor] and the function [XmlDocument.transformNode] are not supported by this browser, can't transform XML document to HTML string!");
	            return null;
	        }
	    }
	};
	
	AjaxRetriever.prototype.loadXslSheet = function(xslSheetUrl, successFunc) {
		
		var result;
		if (typeof XMLHttpRequest !== 'undefined') {
			// Firefox, Chrome and newer IE versions
		    var xhr = new XMLHttpRequest();
		    xhr.open("GET", xslSheetUrl, false);
		    // request MSXML responseXML for IE
		    try { xhr.responseType = 'msxml-document'; } catch(e) { }
		    xhr.send();
		    result = xhr.responseXML;
		} else {
			// Older IE versions: use ActiveXObject
		    try {
		        var xhr = new ActiveXObject('Msxml2.XMLHTTP.3.0');
		        xhr.open('GET', xslSheetUrl, false);
		        xhr.send();
		        result = xhr.responseXML;
		    }
		    catch (e) {
		        // handle case that neither XMLHttpRequest nor MSXML is supported
		        alert("Could not load XSL sheet: " + e.message);
		    }
		}
		
		var errorElements = $(result).find("error"); 
		if (errorElements.length > 0) {
			var message = errorElements.find("message").text();
			alert("ERROR: " + message);
			return;
		}
		successFunc(result);
	};
	
})();