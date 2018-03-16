(function () {
    Alfresco.logger.debug("dnd-upload-plus.js");

    // Firefox multi-upload detection
    var docList = Alfresco.DocumentList;
    if (docList) {
      var oldOnDocumentListDrop = docList.prototype.onDocumentListDrop;
      docList.prototype.onDocumentListDrop = function DL_onDocumentListDrop(e) {
        var dndUpload = Alfresco.util.ComponentManager.findFirst("Alfresco.DNDUpload");
        if (dndUpload && YAHOO.env.ua.gecko) {
          delete dndUpload.firefoxMultiUpload;
          delete dndUpload.firefoxMultiUploadReady;

          try {
            if (e.dataTransfer.files !== undefined && e.dataTransfer.files !== null && e.dataTransfer.files.length > 0) {
              dndUpload.firefoxMultiUpload = true;
            }
          } catch(exception) {
            Alfresco.logger.error("An error occurred on drop event: ", exception);
          }
        }

        oldOnDocumentListDrop.call(this, e);
      };
    }

    var oldConstructor = Alfresco.DNDUpload;
    Alfresco.DNDUpload = function (htmlId) {
        Alfresco.logger.debug("DNDUpload constructor");
        var that = new oldConstructor(htmlId);
        YAHOO.lang.augmentObject(that, SoftwareLoop.UploaderPlusMixin);
        YAHOO.lang.augmentObject(that, {
            //**************************************************************************
            // Initialisation at show
            //**************************************************************************

            show: function (config) {
                Alfresco.logger.debug("show", arguments);
                delete this.types;
                Alfresco.DNDUpload.prototype.show.call(this, config);

                this.loadTypes(SoftwareLoop.hitch(this, function () {
                    Alfresco.logger.debug("loadTypes callback");
                    this.populateSelect();
                    if (this.spawnUploadsBooked) {
                        Alfresco.logger.debug("this.spawnUploadsBooked is true");
                        delete this.spawnUploadsBooked;
                        this._spawnUploads();
                    }
                }));
                Alfresco.logger.debug("END show");
            },

            _spawnUploads: function () {
              Alfresco.logger.debug("_spawnUploads", arguments);

              // Firefox multi-upload management
              // We delay upload treatment, until types has been loaded
              if (this.firefoxMultiUpload && !this.firefoxMultiUploadReady) {
                Alfresco.logger.debug("Upload multiple files with firefox");

                // loadTypes has not been called yet, skip upload treatment
                if (typeof(this.types) === "undefined") {
                  Alfresco.logger.debug("Types not loaded yet. Postponing");
                  this.spawnUploadsBooked = true;
                  return;
                }

                if (this.dataTable.getRecordSet().getLength() == Object.keys(this.fileStore).length) {
                  this.firefoxMultiUploadReady = true;
                  this.currentRecordIndex = 0;

                  // Begin upload
                  if (this.types) {
                    this.savedDialogTitle = YAHOO.util.Dom.get(this.id + "-title-span").innerText;
                    this.records = this.dataTable.getRecordSet().getRecords();
                    Alfresco.logger.debug("records", this.records);
                    this.showMetadataDialog();
                  } else {
                    return Alfresco.DNDUpload.prototype._spawnUploads.apply(this);
                  }
                }
                return;
              }

              if (typeof(this.types) === "undefined") {
                  Alfresco.logger.debug("Types not loaded yet. Postponing");
                  this.spawnUploadsBooked = true;
                  return;
              }
              if (this.showConfig.mode === this.MODE_SINGLE_UPDATE) {
                  Alfresco.logger.debug("Single update");
                  return Alfresco.DNDUpload.prototype._spawnUploads.apply(this);
              }
              if (!this.types) {
                Alfresco.logger.debug("Types is null");
                return Alfresco.DNDUpload.prototype._spawnUploads.apply(this);
              }
              this.savedDialogTitle =
                  YAHOO.util.Dom.get(this.id + "-title-span").innerText;
              this.records = this.dataTable.getRecordSet().getRecords();
              Alfresco.logger.debug("records", this.records);
              this.currentRecordIndex = 0;
              this.showMetadataDialog();
              Alfresco.logger.debug("END _spawnUploads");
            },

            /**
             * @method _addFiles
             * @param i The index in the file to upload
             * @param max The count of files to upload (recursion stops when i is no longer less than max)
             * @param scope Should be set to the widget scope (i.e. this).
             */
            _addFiles: function (i, max, scope) {
               var uniqueFileToken;
               if (i < max)
               {
                  var file = scope.showConfig.files[i];
                  if (!this._getFileValidationErrors(file))
                  {
                     //**************************************************************************
                     // UploaderPlus customization
                     // Generate unique file id to allow multi-upload on firefox
                     //**************************************************************************
                     var id = 'xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                       var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                       return v.toString(16);
                     });
                     //**************************************************************************
                     // End uploaderPlus customization
                     //**************************************************************************
                     var fileId = "file-" + id + "-" + i;
                     try
                     {
                        /**
                         * UPLOAD PROGRESS LISTENER
                         */
                        var progressListener = function DNDUpload_progressListener(e)
                        {
                          Alfresco.logger.debug("File upload progress update received", e);
                          if (e.lengthComputable)
                          {
                              try
                              {
                                 var percentage = Math.round((e.loaded * 100) / e.total),
                                     fileInfo = scope.fileStore[fileId];
                                 fileInfo.progressPercentage.innerHTML = percentage + "%";

                                 // Set progress position
                                 var left = (-400 + ((percentage/100) * 400));
                                 Dom.setStyle(fileInfo.progress, "left", left + "px");
                                 scope._updateAggregateProgress(fileInfo, e.loaded);

                                 // Save value of how much has been loaded for the next iteration
                                 fileInfo.lastProgress = e.loaded;
                              }
                              catch(exception)
                              {
                                 Alfresco.logger.error("The following error occurred processing an upload progress event: ", exception);
                              }
                          }
                          else
                          {
                              Alfresco.logger.debug("File upload progress not computable", e);
                          }
                       };

                       /**
                        * UPLOAD COMPLETION LISTENER
                        */
                       var successListener = function DNDUpload_successListener(e)
                       {
                          try
                          {
                             Alfresco.logger.debug("File upload completion notification received", e);

                             // The individual file has been transfered completely
                             // Now adjust the gui for the individual file row
                             var fileInfo = scope.fileStore[fileId];
                             if (fileInfo.request.readyState != 4)
                             {
                                // There is an occasional timing issue where the upload completion event fires before
                                // the readyState is correctly updated. This means that we can't check the upload actually
                                // completed successfully, if this occurs then we'll attach a function to the onreadystatechange
                                // extension point and things to catch up before we check everything was ok...
                                fileInfo.request.onreadystatechange = function DNDUpload_onreadystatechange()
                                {
                                   if (fileInfo.request.readyState == 4)
                                   {
                                      scope._processUploadCompletion(fileInfo);
                                   }
                                }
                             }
                             else
                             {
                                // If the request correctly indicates that the response has returned then we can process
                                // it to ensure that files have been uploaded correctly.
                                scope._processUploadCompletion(fileInfo);
                             }
                          }
                          catch(exception)
                          {
                             Alfresco.logger.error("The following error occurred processing an upload completion event: ", exception);
                          }
                        };

                        /**
                         * UPLOAD FAILURE LISTENER
                         */
                        var failureListener = function DNDUpload_failureListener(e)
                        {
                           try
                           {
                              var fileInfo = scope.fileStore[fileId];

                                 // This sometimes gets called twice, make sure we only adjust the gui once
                                 if (fileInfo.state !== scope.STATE_FAILURE)
                                 {
                                    scope._processUploadFailure(fileInfo, e.status);
                                 }
                              }
                              catch(exception)
                           {
                              Alfresco.logger.error("The following error occurred processing an upload failure event: ", exception);
                           }
                        };

                        // Get the name of the file (note that we use ".name" and NOT ".fileName" which is non-standard and it's use
                        // will break FireFox 7)...
                        var fileName = file.name,
                            updateNameAndMimetype = false;
                        if (!!scope.showConfig.newVersion && scope.showConfig.updateFilename && scope.showConfig.updateFilename !== fileName)
                        {
                            updateNameAndMimetype = true;
                        }

                        // Add the event listener functions to the upload properties of the XMLHttpRequest object...
                        var request = new XMLHttpRequest();

                        // Add the data to the upload property of XMLHttpRequest so that we can determine which file each
                        // progress update relates to (the event argument passed in the progress function does not contain
                        // file name details)...
                        request.upload._fileData = fileId;
                        request.upload.addEventListener("progress", progressListener, false);
                        request.upload.addEventListener("load", successListener, false);
                        request.upload.addEventListener("error", failureListener, false);

                        // Construct the data that will be passed to the YUI DataTable to add a row...
                        data = {
                            id: fileId,
                            name: fileName,
                            size: scope.showConfig.files[i].size
                        };

                        // Get the nodeRef to update if available (this is required to perform version update)...
                        var updateNodeRef = null;
                        if (scope.suppliedConfig && scope.suppliedConfig.updateNodeRef)
                        {
                           updateNodeRef = scope.suppliedConfig.updateNodeRef;
                        }

                        // Construct an object containing the data required for file upload...
                        var uploadDir = file.relativePath || "";
                        if (scope.showConfig.uploadDirectory && scope.showConfig.uploadDirectory !== "/")
                        {
                           uploadDir = scope.showConfig.uploadDirectory + "/" + uploadDir;
                        }
                        var uploadData =
                        {
                           filedata: scope.showConfig.files[i],
                           filename: fileName,
                           destination: scope.showConfig.destination,
                           siteId: scope.showConfig.siteId,
                           containerId: scope.showConfig.containerId,
                           uploaddirectory: uploadDir,
                           createdirectory: true,
                           majorVersion: !scope.minorVersion.checked,
                           updateNodeRef: updateNodeRef,
                           description: scope.description.value,
                           overwrite: scope.showConfig.overwrite,
                           thumbnails: scope.showConfig.thumbnails,
                           username: scope.showConfig.username,
                           updateNameAndMimetype: updateNameAndMimetype
                        };

                        // Add the upload data to the file store. It is important that we don't initiate the XMLHttpRequest
                        // send operation before the YUI DataTable has finished rendering because if the file being uploaded
                        // is small and the network is quick we could receive the progress/completion events before we're
                        // ready to handle them.
                        scope.fileStore[fileId] =
                        {
                           state: scope.STATE_ADDED,
                           fileName: fileName,
                           nodeRef: updateNodeRef,
                           uploadData: uploadData,
                           request: request
                        };

                        // Add file to file table
                        scope.dataTable.addRow(data);
                        scope.addedFiles[uniqueFileToken] = scope._getUniqueFileToken(data);

                        // Enable the Esc key listener
                        scope.widgets.escapeListener.enable();
                        scope.panel.setFirstLastFocusable();
                        scope.panel.show();
                     }
                     catch(exception)
                     {
                        Alfresco.logger.error("DNDUpload_show: The following exception occurred processing a file to upload: ", exception);
                     }
                  }

                  // If we've not hit the max, recurse info the function...
                  scope._addFiles(i+1, max, scope);
               }
            },

            //**************************************************************************
            // Metadata dialog management
            //**************************************************************************

            showMetadataDialog: function () {
                Alfresco.logger.debug("showMetadataDialog", arguments);
                if (this.currentRecordIndex == this.records.length) {
                    Alfresco.logger.debug("At the end of the records array");
                    this.showMainDialog();
                    return Alfresco.DNDUpload.prototype._spawnUploads.apply(this);
                }
                var currentRecord = this.records[this.currentRecordIndex];
                var data = currentRecord.getData();
                var fileId = data.id;
                var fileInfo = this.fileStore[fileId];
                if (fileInfo.state !== this.STATE_ADDED) {
                    Alfresco.logger.debug("State != STATE_ADDED");
                    return Alfresco.DNDUpload.prototype._spawnUploads.apply(this);
                }

                YAHOO.util.Dom.get(this.id + "-title-span").innerText =
                    Alfresco.util.encodeHTML(data.name);

                YAHOO.util.Dom.addClass(this.id + "-main-dialog", "fake-hidden");
                YAHOO.util.Dom.removeClass(this.id + "-metadata-dialog", "hidden");

                this.contentTypeSelectNode.selectedIndex = 0;
                SoftwareLoop.fireEvent(this.contentTypeSelectNode, "change");
                Alfresco.logger.debug("END showMetadataDialog");
            },

            showMainDialog: function () {
                Alfresco.logger.debug("showMainDialog", arguments);
                if (this.savedDialogTitle) {
                    Alfresco.logger.debug("Restore saved dialog title");
                    YAHOO.util.Dom.get(this.id + "-title-span").innerText =
                        this.savedDialogTitle;
                    delete this.savedDialogTitle;
                }

                delete this.records;
                delete this.currentRecordIndex;

                YAHOO.util.Dom.removeClass(this.id + "-main-dialog", "fake-hidden");
                YAHOO.util.Dom.addClass(this.id + "-metadata-dialog", "hidden");
                this.centerPanel();
                Alfresco.logger.debug("END showMainDialog");
            },

            _resetGUI: function () {
                Alfresco.logger.debug("_resetGUI", arguments);
                this.showMainDialog();
                Alfresco.DNDUpload.prototype._resetGUI.apply(this, arguments);
                Alfresco.logger.debug("END _resetGUI");
            },

            //**************************************************************************
            // Form button handling
            //**************************************************************************


            onMetadataCancel: function (event) {
                Alfresco.logger.debug("onMetadataCancel", arguments);
                this.showMainDialog();
                this.onCancelOkButtonClick(event);
                Alfresco.logger.debug("END onMetadataCancel");
            },

            //**************************************************************************
            // Upload override
            //**************************************************************************

            _startUpload: function (fileInfo) {
                Alfresco.logger.debug("_startUpload", arguments);
                // Mark file as being uploaded
                fileInfo.state = this.STATE_UPLOADING;

                var url;
                if (this.showConfig.uploadURL === null) {
                    url = Alfresco.constants.PROXY_URI + "api/upload";
                }
                else {
                    url = Alfresco.constants.PROXY_URI + this.showConfig.uploadURL;
                }
                if (Alfresco.util.CSRFPolicy.isFilterEnabled()) {
                    url += "?" + Alfresco.util.CSRFPolicy.getParameter() + "=" + encodeURIComponent(Alfresco.util.CSRFPolicy.getToken());
                }

                if (this.uploadMethod === this.FORMDATA_UPLOAD) {
                    // For Browsers that support it (currently FireFox 4), the FormData object is the best
                    // object to use for file upload as it supports asynchronous multipart upload without
                    // the need to read the entire object into memory.
                    Alfresco.logger.debug("Using FormData for file upload");
                    var formData = new FormData;
                    formData.append("filedata", fileInfo.uploadData.filedata);
                    formData.append("filename", fileInfo.uploadData.filename);
                    formData.append("destination", fileInfo.uploadData.destination);
                    formData.append("siteId", fileInfo.uploadData.siteId);
                    formData.append("containerId", fileInfo.uploadData.containerId);
                    formData.append("uploaddirectory", fileInfo.uploadData.uploaddirectory);
                    formData.append("createdirectory", fileInfo.uploadData.createdirectory ? "true" : "false");
                    formData.append("majorVersion", fileInfo.uploadData.majorVersion ? "true" : "false");
                    formData.append("username", fileInfo.uploadData.username);
                    formData.append("overwrite", fileInfo.uploadData.overwrite);
                    formData.append("thumbnails", fileInfo.uploadData.thumbnails);
                    formData.append("updatenameandmimetype", fileInfo.uploadData.updateNameAndMimetype);

                    if (fileInfo.uploadData.updateNodeRef) {
                        formData.append("updateNodeRef", fileInfo.uploadData.updateNodeRef);
                    }
                    if (fileInfo.uploadData.description) {
                        formData.append("description", fileInfo.uploadData.description);
                    }

                    // BEGIN: uploader-plus customisations
                    Alfresco.logger.debug("fileInfo", fileInfo);
                    if (this.contentTypeSelectNode && this.contentTypeSelectNode.value) {
                        Alfresco.logger.debug("Appending content type", this.contentTypeSelectNode.value);
                        formData.append("contentType", this.contentTypeSelectNode.value);
                    }
                    if (fileInfo.propertyData) {
                        Alfresco.logger.debug("Processing propertyData");
                        for (var current in fileInfo.propertyData) {
                            Alfresco.logger.debug("Current:", current);
                            if (fileInfo.propertyData.hasOwnProperty(current) &&
                                (current.indexOf("prop_") === 0 || current.indexOf("assoc_") === 0)) {
                                if (current != "prop_mimetype" || (current == "prop_mimetype" && fileInfo.propertyData[current] && fileInfo.propertyData[current].length > 0)) {
                                    Alfresco.logger.debug("Appending", current);
                                    formData.append(current, fileInfo.propertyData[current]);
                                }
                            }
                        }
                    }
                    Alfresco.logger.debug("formData:", formData);
                    // END: uploader-plus customisations

                    fileInfo.request.open("POST", url, true);
                    fileInfo.request.send(formData);
                }
                else if (this.uploadMethod === this.INMEMORY_UPLOAD) {
                    Alfresco.logger.debug("Using custom multipart upload");

                    // PLEASE NOTE: Be *VERY* careful modifying the following code, this carefully constructs a multipart formatted request...
                    var multipartBoundary = "----AlfrescoCustomMultipartBoundary" + (new Date).getTime();
                    var rn = "\r\n";
                    var customFormData = "--" + multipartBoundary;

                    // Add the file parameter...
                    customFormData += rn + "Content-Disposition: form-data; name=\"filedata\"; filename=\"" + unescape(encodeURIComponent(fileInfo.uploadData.filename)) + "\"";
                    customFormData += rn + "Content-Type: image/png";
                    customFormData += rn + rn + fileInfo.uploadData.filedata.getAsBinary() + rn + "--" + multipartBoundary; // Use of getAsBinary should be fine here - in-memory upload is only used pre FF4

                    // Add the String parameters...
                    customFormData += rn + "Content-Disposition: form-data; name=\"filename\"";
                    customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.filename)) + rn + "--" + multipartBoundary;
                    customFormData += rn + "Content-Disposition: form-data; name=\"destination\"";
                    if (fileInfo.uploadData.destination !== null) {
                        customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.destination)) + rn + "--" + multipartBoundary;
                    }
                    else {
                        customFormData += rn + rn + rn + "--" + multipartBoundary;
                    }
                    customFormData += rn + "Content-Disposition: form-data; name=\"siteId\"";
                    customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.siteId)) + rn + "--" + multipartBoundary;
                    customFormData += rn + "Content-Disposition: form-data; name=\"containerId\"";
                    customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.containerId)) + rn + "--" + multipartBoundary;
                    customFormData += rn + "Content-Disposition: form-data; name=\"uploaddirectory\"";
                    customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.uploaddirectory)) + rn + "--" + multipartBoundary + "--";
                    customFormData += rn + "Content-Disposition: form-data; name=\"majorVersion\"";
                    customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.majorVersion)) + rn + "--" + multipartBoundary + "--";
                    if (fileInfo.uploadData.updateNodeRef) {
                        customFormData += rn + "Content-Disposition: form-data; name=\"updateNodeRef\"";
                        customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.updateNodeRef)) + rn + "--" + multipartBoundary + "--";
                    }
                    if (fileInfo.uploadData.description) {
                        customFormData += rn + "Content-Disposition: form-data; name=\"description\"";
                        customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.description)) + rn + "--" + multipartBoundary + "--";
                    }
                    if (fileInfo.uploadData.username) {
                        customFormData += rn + "Content-Disposition: form-data; name=\"username\"";
                        customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.username)) + rn + "--" + multipartBoundary + "--";
                    }
                    if (fileInfo.uploadData.overwrite) {
                        customFormData += rn + "Content-Disposition: form-data; name=\"overwrite\"";
                        customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.overwrite)) + rn + "--" + multipartBoundary + "--";
                    }
                    if (fileInfo.uploadData.thumbnails) {
                        customFormData += rn + "Content-Disposition: form-data; name=\"thumbnails\"";
                        customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.uploadData.thumbnails)) + rn + "--" + multipartBoundary + "--";
                    }

                    // BEGIN: uploader-plus customisations
                    if (this.contentTypeSelectNode && this.contentTypeSelectNode.value) {
                        customFormData += rn + "Content-Disposition: form-data; name=\"contentType\"";
                        customFormData += rn + rn + unescape(encodeURIComponent(this.contentTypeSelectNode.value)) + rn + "--" + multipartBoundary + "--";
                    }
                    if (fileInfo.propertyData) {
                        for (var current in fileInfo.propertyData) {
                            if (fileInfo.propertyData.hasOwnProperty(current) &&
                                (current.indexOf("prop_") === 0 || current.indexOf("assoc_") === 0)) {
                                if (current != "prop_mimetype" || (current == "prop_mimetype" && fileInfo.propertyData[current] && fileInfo.propertyData[current].length > 0)) {
                                    customFormData += rn + "Content-Disposition: form-data; name=\"" + current + "\"";
                                    customFormData += rn + rn + unescape(encodeURIComponent(fileInfo.propertyData[current])) + rn + "--" + multipartBoundary + "--";
                                }
                            }
                        }
                    }
                    // END: uploader-plus customisations


                    fileInfo.request.open("POST", url, true);
                    fileInfo.request.setRequestHeader("Content-Type", "multipart/form-data; boundary=" + multipartBoundary);
                    fileInfo.request.sendAsBinary(customFormData);
                }
            }

        }, true);
        return that;
    };
    Alfresco.DNDUpload.superclass = oldConstructor.superclass;
    Alfresco.DNDUpload.prototype = oldConstructor.prototype;
})();
