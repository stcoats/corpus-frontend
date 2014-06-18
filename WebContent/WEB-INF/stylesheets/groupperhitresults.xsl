<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
	<xsl:output method="html" omit-xml-declaration="yes" />
	<xsl:param name="urlparamwithoutstart" select="'#'"/>
	<xsl:param name="urlparamwithoutview" select="'#'"/>
	<xsl:param name="urlparamwithoutvieworgroup" select="'#'"/>
	<xsl:param name="urlparamwithoutsort" select="'#'"/>
    <xsl:param name="query" select="'#'"/>
	
	<xsl:param name="webserviceurl" select="'#'"/>
    <xsl:param name="backendRequestUrl" select="'#'"/>
	<xsl:param name="resultkey" select="'#'"/>
	
	<xsl:param name="pos_name" select="'#'"/>
	<xsl:param name="lemma_name" select="'#'"/>
	<xsl:param name="title_name" select="'#'"/>
	<xsl:param name="author_name" select="'#'"/>
	<xsl:param name="date_name" select="'#'"/>
	<xsl:param name="source_name" select="'#'"/>
	<xsl:param name="groupBy_name" select="'#'"/>
	
	<xsl:template match="error">
		<h1>Error</h1>
        <xsl:value-of select="message" />
	</xsl:template>
	
	<xsl:template match="summary">
		<div class="pull-right">
			<small>Query: <xsl:value-of select="$query" /> - Duration: <xsl:value-of select="search-time" />ms</small>
		</div>
	</xsl:template>
	
    <xsl:template match="status">
        <div class="span12 contentbox" id="results">
            <div id='waitDisplay' class="alert alert-info">
                Searching, please wait...
                <p class="text-center"><i class="icon-spinner icon-spin xxlarge"></i></p>
            </div>
            <script type="text/javascript">
                var backendRequestUrl = '<xsl:value-of select="$backendRequestUrl" />';
                var checkAgain = <xsl:choose>
                    <xsl:when test="check-again-ms"><xsl:value-of select="check-again-ms" /></xsl:when>
                    <xsl:otherwise>1000</xsl:otherwise>
                </xsl:choose>;
                setTimeout(function () {
                    doResults(backendRequestUrl, checkAgain);
                }, checkAgain);
            </script>
        </div>
    </xsl:template>
    
	<xsl:template match="hitgroups">
		<div class="span12 contentbox" id="results">
			<ul class="nav nav-tabs" id="contentTabs">
				<li><a><xsl:attribute name="href"><xsl:value-of select="$urlparamwithoutvieworgroup" /><xsl:value-of select="'view=1'" /></xsl:attribute>Per Hit</a></li>
				<li><a><xsl:attribute name="href"><xsl:value-of select="$urlparamwithoutvieworgroup" /><xsl:value-of select="'view=2'" /></xsl:attribute>Per Document</a></li>
				<li class="active"><a><xsl:attribute name="href"><xsl:value-of select="$urlparamwithoutvieworgroup" /><xsl:value-of select="'view=8'" /></xsl:attribute>Hits grouped</a></li>
				<li><a><xsl:attribute name="href"><xsl:value-of select="$urlparamwithoutvieworgroup" /><xsl:value-of select="'view=16'" /></xsl:attribute>Documents grouped</a></li>
			</ul>
			<select class="input" name="groupBy" onchange="document.searchform.submit();">
				<option value="" disabled="true"><xsl:if test="'' = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group hits by...</option>
                <xsl:variable name="sortByTitleValue">field:<xsl:value-of select="$title_name" /></xsl:variable>
				<option><xsl:attribute name="value"><xsl:value-of select="$sortByTitleValue" /></xsl:attribute><xsl:if test="$sortByTitleValue = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by document title</option>
				<option value="hit"><xsl:if test="'hit' = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by hit text</option>
				<option><xsl:attribute name="value">hit:<xsl:value-of select="$lemma_name" /></xsl:attribute><xsl:if test="$lemma_name = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by lemma</option>
				<option><xsl:attribute name="value">hit:<xsl:value-of select="$pos_name" /></xsl:attribute><xsl:if test="$pos_name = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by hit pos</option>
				<option value="hit:lemma,hit:pos"><xsl:if test="'hit:lemma,hit:pos' = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by lemma and PoS</option>
				<option value="wordleft"><xsl:if test="'wordleft' = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by word left</option>
				<option value="wordright"><xsl:if test="'wordright' = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by word right</option>
				<option><xsl:attribute name="value">field:<xsl:value-of select="$date_name" /></xsl:attribute><xsl:if test="$date_name = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by year</option>
				<option><xsl:attribute name="value">field:<xsl:value-of select="$date_name" /></xsl:attribute><xsl:attribute name="disabled">true</xsl:attribute><xsl:if test="'decade' = $groupBy_name"><xsl:attribute name="selected"><xsl:value-of select="'true'" /></xsl:attribute></xsl:if>Group by decade</option>
			</select> 
			<div class="tab-pane active lightbg haspadding">
				<table>
					<thead>
						<tr>
							<th class="tbl_groupname"><a><xsl:attribute name="href"><xsl:value-of select="$urlparamwithoutsort" /><xsl:value-of select="'sortBy=title'" /></xsl:attribute>Group</a></th>
							<th><a><xsl:attribute name="href"><xsl:value-of select="$urlparamwithoutsort" /><xsl:value-of select="'sortBy=size'" /></xsl:attribute>Hits</a></th>
						</tr>
					</thead>
					<tbody>		
					<xsl:for-each select="hitgroup">	
						<xsl:variable name="width" select="size * 100 div /blacklab-response/summary/largest-group-size" />
						<xsl:variable name="rowId" select="generate-id()"/>
						<xsl:variable name="apos">'</xsl:variable>
						<tr>
							<td><xsl:value-of select="identity-display"/></td>
							<td>
								<div class="progress progress-success" data-toggle="collapse"><xsl:attribute name="data-target"><xsl:value-of select="'.'"/><xsl:value-of select="$rowId"/></xsl:attribute>
									<div class="bar"><xsl:attribute name="style"><xsl:value-of select="'width: '"/><xsl:value-of select="$width"/><xsl:value-of select="'%;'"/></xsl:attribute><xsl:value-of select="size"/></div>
								</div>
								<div><xsl:attribute name="class"><xsl:value-of select="$rowId"/><xsl:value-of select="' collapse groupcontent'"></xsl:value-of></xsl:attribute><xsl:attribute name="id"><xsl:value-of select="$rowId"/></xsl:attribute><xsl:attribute name="data-group"><xsl:value-of select="identity"/></xsl:attribute>
									<div class="inline-concordance">
										<a class="btn btn-link"><xsl:attribute name="href"><xsl:value-of select="$urlparamwithoutvieworgroup" /><xsl:value-of select="'view=1'" /><xsl:value-of select="'&#38;viewGroup='" /><xsl:value-of select="identity"/><xsl:value-of select="'&#38;groupBy='" /><xsl:value-of select="$groupBy_name"/></xsl:attribute>&#171; View detailed concordances in this group</a> - <button class="btn btn-link nolink"><xsl:attribute name="onclick"><xsl:value-of select="'getGroupContent('"/><xsl:value-of select="$apos"/><xsl:value-of select="'#'"/><xsl:value-of select="$rowId"/><xsl:value-of select="$apos"/><xsl:value-of select="');'"/></xsl:attribute>Load more concordances...</button> 
									</div>
								</div>
							</td>
						</tr>					
					</xsl:for-each>
					</tbody>
				</table>
			</div>
		</div>
		<script>
        var backendRequestUrl = '<xsl:value-of select="$backendRequestUrl" />';
            
		$(document).ready(function() {
		    scrollToResults();
		    $('.nolink').click(function(event) { event.preventDefault();});
		    $('.groupcontent').on('show', function() { checkIfFirstTimeOpen('#' + $(this).attr('id'));});
		});
		
		function checkIfFirstTimeOpen(element) {
			if(ar_loadFrom[element] == null) 
				getGroupContent(element);
		}
		
		function getGroupContent(element) {				
			var start = 0;
			
			if(ar_loadFrom[element] != null)
				var start = ar_loadFrom[element];
				
			var retriever = new AjaxRetriever(backendRequestUrl, '');
			var groupid = decodeURIComponent($(element).attr('data-group'));
			retriever.putAjaxResponse(element, {
			    viewgroup: groupid,
			    first: start
			}, true, "../js/hitgroup.xsl");
			
			ar_loadFrom[element] = start + 20;
			
			return false;
		}
		
		var ar_loadFrom = [];
		</script>
	</xsl:template>
	
	
	
</xsl:stylesheet>