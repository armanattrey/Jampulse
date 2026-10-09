const {copyFileSync,cpSync,mkdirSync} = require('node:fs');
const {join} = require('node:path');
const source = __dirname;
const destination = join(source,'www');
mkdirSync(join(destination,'assets'),{recursive:true});
for (const file of ['index.html','app.js','style.css']) copyFileSync(join(source,file),join(destination,file));
cpSync(join(source,'assets'),join(destination,'assets'),{recursive:true});
