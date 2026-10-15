import {readFile} from 'node:fs/promises';
const text=(await readFile(process.argv[2],'utf8'))
  .replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[research module]');
const index=text.indexOf('[Bottom up');
if(index<0)throw new Error('V8 bottom-up section missing');
console.log(text.slice(index,index+12000));
