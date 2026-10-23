import { writeFileSync, mkdirSync } from 'node:fs';
import { documentSchema } from './schema.js';
mkdirSync('dist/schema',{recursive:true});
writeFileSync('dist/schema/document.schema.json',JSON.stringify(documentSchema,null,2)+'\n');
