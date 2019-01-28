function cleanUpPath(path) {
    if (path == null || path.length == 0) {
        path = "/";
    }
    if (path.charAt(path.length - 1) != "/") {
        path = path + "/";
    }
    if (path.charAt(0) == "/" && path.length > 1) {
        path = path.substr(1);
    }
    return path;
}

var destination = args.destination;
var siteId = args.siteid;
var containerId = args.containerid;
var path = cleanUpPath(args.path);
if (logger.isLoggingEnabled()) {
	logger.log("destination: " + destination);
	logger.log("siteId: " + siteId);
	logger.log("containerId: " + containerId);
	logger.log("args.path: " + args.path);
	logger.log("path: " + path);
}

var destNode = null;
var initialDestNode = null;
if (destination !== null) {
    destNode = search.findNode(destination);
    initialDestNode = destNode;
} else if (siteId !== null) {
    var site = siteService.getSite(siteId);
    destNode = site.getContainer(containerId);
    destNode = destNode.childByNamePath(path);
    initialDestNode = destNode;
}


while (destNode !== null && !destNode.hasAspect("up:UploadFolder")) {
    destNode = destNode.parent;
}

if (destNode === null) {
    model.types = null;
} else {
    var excludedSubFolders = destNode.associations["up:excludedSubFolders"] || [];
    for (var i = 0, ii = excludedSubFolders.length; i < ii; i++) {
      var excludedSubFolder = excludedSubFolders[i];
      if (excludedSubFolder.nodeRef.equals(destNode.nodeRef)) {
        break;
      }
    }
    model.types = isExcludedFolder(destNode, initialDestNode) ? null : destNode.properties["up:allowedTypes"];
}

function isExcludedFolder(destNode, initialDestNode) {
  var excludedSubFolders = destNode.associations["up:excludedSubFolders"] || [];
  for (var i = 0, ii = excludedSubFolders.length; i < ii; i++) {
  var excludedSubFolder = excludedSubFolders[i];
    if (excludedSubFolder.nodeRef.equals(initialDestNode.nodeRef)) {
      return true;
    }
  }
  return false;
}
