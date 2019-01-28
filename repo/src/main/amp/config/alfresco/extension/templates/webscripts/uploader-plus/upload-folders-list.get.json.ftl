<#escape x as jsonUtils.encodeJSONString(x)>
{
"results" : [
    <#list nodes as node>
    {
    "nodeRef": "${node.nodeRef}",
    "path": "${node.displayPath}\/${node.properties.name}",
    "allowedTypes": [
        <#if node.properties["up:allowedTypes"]??>
            <#list node.properties["up:allowedTypes"] as allowedType>
            "${allowedType}"<#if allowedType_has_next>,</#if>
            </#list>
        </#if>
    ],
    "excludedSubFoldersName": [
      <#if node.associations["up:excludedSubFolders"]?has_content>
        <#list node.associations["up:excludedSubFolders"] as excludedSubFolder>
          "${excludedSubFolder.properties.name}"<#if excludedSubFolder_has_next>,</#if>
        </#list>
      </#if>
    ]
    }<#if node_has_next>,</#if>
    </#list>
]
}
</#escape>