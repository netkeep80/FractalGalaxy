import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const moduleRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PLAIN_SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function nextPatchVersion(version){
  const match=PLAIN_SEMVER.exec(String(version));
  if(!match)throw new Error('project version must be plain SemVer MAJOR.MINOR.PATCH');
  const major=Number(match[1]),minor=Number(match[2]),patch=Number(match[3]);
  if(!Number.isSafeInteger(major)||!Number.isSafeInteger(minor)||!Number.isSafeInteger(patch)){
    throw new Error('project version components must be safe integers');
  }
  if(patch===Number.MAX_SAFE_INTEGER)throw new Error('project patch version overflow');
  return major+'.'+minor+'.'+(patch+1);
}

export async function bumpProjectVersion({root=moduleRoot}={}){
  const versionPath=resolve(root,'version.json');
  const packagePath=resolve(root,'package.json');
  const [versionDoc,packageDoc]=await Promise.all([
    readFile(versionPath,'utf8').then(JSON.parse),
    readFile(packagePath,'utf8').then(JSON.parse)
  ]);
  if(typeof versionDoc.version!=='string')throw new Error('version.json.version is required');
  if(packageDoc.version!==versionDoc.version){
    throw new Error('version.json and package.json are not synchronized');
  }
  const next=nextPatchVersion(versionDoc.version);
  versionDoc.version=next;
  packageDoc.version=next;
  await Promise.all([
    writeFile(versionPath,JSON.stringify(versionDoc,null,2)+'\n'),
    writeFile(packagePath,JSON.stringify(packageDoc,null,2)+'\n')
  ]);
  return next;
}

const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  const next=await bumpProjectVersion();
  process.stdout.write(next+'\n');
}
