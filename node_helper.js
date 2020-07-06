const NodeHelper = require("node_helper");
const path = require("path");
const fs = require('fs');

module.exports = NodeHelper.create({
	start: function(){
		this.createRoutes(this);
		this.configPath = path.join(__dirname, "../..", "config/config.js");
		this.tempConfigPath = path.join(__dirname, "../..", "config/config.page_selector_temp.js");
		this.tempPath = path.join(__dirname, "temp.json")
	},

	//Page can also be changed externally by calling to the /selectPage endpoint
	createRoutes: function() {
		const self = this;

		self.expressApp.get("/selectPage/:pageId", (req, res) => {
			self.sendSocketNotification("PAGE_SELECT", req.params.pageId.toLowerCase());
			res.send(`Updating page to ${req.params.pageId.toLowerCase()}`);
		});
	},

	socketNotificationReceived: function(notification, payload) {
		const self = this;
		if(notification === "UPDATE_PAGES"){
			self.getModulePages();
		}else if(notification === "WRITE_TEMP"){
			self.writeTemp(payload);
		}else if(notification === "RESTORE_PAGE"){
			self.restorePage()
		}
	},

	getTempObject: function(){
		try{
			var obj = fs.readFileSync(this.tempPath);
			jsonObj = JSON.parse(obj);
			return jsonObj;
		}catch(err){
			return {};
		}
	},

	writeTemp: function(updateVals){
		//updateVals is an object that gets written into the temp file
		const self = this;
		temp = self.getTempObject();
		keys = Object.keys(updateVals);
		keys.forEach(key => {
			temp[key] = updateVals[key];
		})
		return new Promise((resolve, reject) => {
			fs.writeFile(self.tempPath, JSON.stringify(temp), function(err) {
			    if(err) {
			        reject(err);
			    }

			    resolve();
			}); 
		})
	},

	getTemp: function(keys){
		//keys defines the info that will be returned from the temp object
		const self = this;
		res_temp = {};
		temp = self.getTempObject();
		keys.forEach(key => {
			if(temp.hasOwnProperty(key)){
				res_temp[key] = temp[key]
			}
		})
		return res_temp
	},

	restorePage: function(){
		const self = this;
		temp = self.getTemp(["page"]);
		if(temp.hasOwnProperty("page")){
			self.sendSocketNotification("PAGE_SELECT", temp["page"]);
		}else{
			self.sendSocketNotification("PAGE_SELECT", 0)
		}
	},

	moveOldConfig: function(){
		const self = this;
		return new Promise(resolve => {
			fs.rename(self.configPath, self.tempConfigPath, () =>{
				resolve();
			})
		})
	},

	myStringify: function(json){
		const functions = [];
		const jsonReplacer = function (key, val) {
		    if (typeof val === 'function') {
		  	    functions.push(val.toString());
		        
		        return "{func_" + (functions.length - 1) + "}";
		    }
		        
		    return val;
		};
		const funcReplacer = function (match, id) {
		   return functions[id];
		};
		return JSON.stringify(json, jsonReplacer, 4).replace(/"\{func_(\d+)\}"/g, funcReplacer);
	},

	writeNewConfig: function(config){
		const self = this;
		let fileString = ""
		fileString += "//Auto-Generated by page selector in order to save your config while it messes with positions\n\n";
		fileString += "var config = "
		fileString += self.myStringify(config) + "\n";
		fileString += "/*************** DO NOT EDIT THE LINE BELOW ***************/\nif (typeof module !== 'undefined') {\nmodule.exports = config;\n}";
		return new Promise((resolve, reject) => {
			fs.writeFile(self.configPath, fileString, function(err) {
			    if(err) {
			        reject(err);
			    }

			    resolve();
			}); 
		})
	},

	restoreOldConfig: function(){
		const self = this;
		return new Promise(resolve => {
			fs.rename(self.tempConfigPath, self.configPath, () => {
				resolve()
			})
		})
	},

	getModulePages: async function(){
		const self = this;

		//WHY NODE?
		delete require.cache[require.resolve(self.configPath)]
		const config = require(self.configPath);
		const pageConfig = {};
		let exclusions = [];
		//This tells Page-Selector whether there are modules that dont have positions and so need to be re-rendered
		let reRender = false;
		// There are two options when defining pages and locations.
		// If the pages are explicitly defined then that definition is used. 
		// If they are not, then the config for each module is searched to find the pages key
		if(config.hasOwnProperty("pages")){
			const pages = config.pages;
			const modules = config.modules;
			const pageNames = Object.keys(pages);

			pageNames.forEach(page_name => {
                
				const page = pages[page_name];
				const page_module_names = Object.keys(page);
                var skip_this_page = false;
                
                if( page_module_names.includes("disabled") ) //skip the page creation
                {
                    
                    if( String(page["disabled"])=="true" ) //skip the page creation
                    {
                        skip_this_page = true;
                    }
                    page_module_names.splice("disabled",1);  //disabled needs to be purged from array json
                }
                
                if (!skip_this_page){
                    const page_store = {};
                    pageConfig[page_name.toLowerCase()] = Array(page_module_names.length);
                    
                    
                    modules.forEach((module, index) => {
                        const module_name = module.module;
                        
                        const name = module.name;
                        if(!module.disabled){
                            
                            const id = `module_${index}_${module_name}`;
                            if(page_module_names.includes(module_name)){
                                if(typeof module.position === "undefined"){
                                    reRender = true;
                                    module.position = page[module_name]
                                }
                                page_store[id] = {position: page[module_name], index: page_module_names.indexOf(module_name)};
                            }
                            if(name !== undefined && page_module_names.includes(name)){
                                if(typeof module.position === "undefined"){
                                    let newPos = page[name];
                                    if(typeof newPos === "undefined" || newPos.toLowerCase() === "none" || newPos === false){
                                        newPos = undefined
                                    }
                                    if(typeof newPos !== "undefined"){
                                        reRender = true;
                                        module.position = page[name];
                                    }
                                }
                                page_store[id] = {position: page[name], index: page_module_names.indexOf(name)};
                            }
                        }
                    })
                    pagePositions = []
                    Object.keys(page_store).forEach(id => {
                        let count = 0;
                        while(typeof pagePositions[page_store[id].index] !== "undefined"){
                            if(count > 1000){
                                throw "Breaking out of loop. If you had this many modules with the same name you messed up anyways."
                            }
                            count++;
                            page_store[id].index++;
                        }
                        pagePositions[page_store[id].index] = {
                            "position": page_store[id].position,
                            "identifier": id
                        }
                    })
                    pageConfig[page_name.toLowerCase()] = pagePositions
                }
            })
            
			if(config.hasOwnProperty("exclusions")){
				const excluded_names = Object.keys(config.exclusions);
				modules.forEach((module, index) => {
					const module_name = module.module;
					const name = module.name;
					const id = `module_${index}_${module_name}`;

					if(excluded_names.includes(module_name) || excluded_names.includes(name)){
						let selector = "";
						if(excluded_names.includes(name)) selector = name
						if(excluded_names.includes(module_name)) selector = module_name
						if(typeof module.position === "undefined"){
							let newPos = config.exclusions[selector];
							if(typeof newPos === "undefined" || newPos.toLowerCase() === "none" || newPos === false){
								newPos = undefined
							}
							if(typeof newPos !== "undefined"){
								reRender = true;
								module.position = config.exclusions[selector];
							}
						}
						exclusions.push({
							"identifier": id,
							"position": config.exclusions[selector],
						})
					}
				})
			}
		}else{
			const modules = config.modules;
			const pageList = [];

			modules.forEach((module, index) => {
				const name = module.module;
				const pages = module.pages;
				if(typeof pages === "object"){
					const modulePages = Object.keys(pages);
					if(typeof module.position === "undefined"){
						let newPos = pages[modulePages[0]];
						if(typeof newPos === "undefined" || newPos.toLowerCase() === "none" || newPos === false){
							newPos = undefined
						}
						if(typeof newPos !== "undefined"){
							reRender = true;
							module.position = pages[modulePages[0]]
						}
					}
					if(modulePages.includes("all")){
						exclusions.push({
							"identifier": `module_${index}_${name}`,
							"position": pages["all"] || pages["All"],
						});
					}else{
						modulePages.forEach(page => {
							if(pageList.indexOf(page.toLowerCase()) === -1){
								pageList.push(page.toLowerCase());
								pageConfig[page.toLowerCase()] = [];
							}
							pageConfig[page.toLowerCase()].push({
								"position": pages[page],
								"identifier": `module_${index}_${name}`
							})
						})
					}
				}
			});
		}
		if(reRender){
			await self.moveOldConfig();
			await self.writeNewConfig(config);
			self.sendSocketNotification("RESTART_DOM");
		}else if(fs.existsSync(self.tempConfigPath)){
			self.restoreOldConfig();
		}
		self.sendSocketNotification("SET_PAGE_CONFIG", pageConfig);
		self.sendSocketNotification("SET_EXCLUSIONS_CONFIG", exclusions);
	}
})
