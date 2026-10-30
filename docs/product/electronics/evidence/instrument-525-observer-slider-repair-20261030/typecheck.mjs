import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const file = 'e2e/electronics-simulation.spec.ts';
const before = execFileSync('git', ['show', `536bded6a:${file}`], { encoding: 'utf8', maxBuffer: 4e6 });
const options = { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, resolveJsonModule: true, esModuleInterop: true, skipLibCheck: true };
function diagnostics(replacement) {
 const host=ts.createCompilerHost(options); const original=host.readFile;
 host.readFile = path => replacement !== undefined && (path.replaceAll('\\','/') === file || path.replaceAll('\\','/').endsWith('/'+file)) ? replacement : original(path);
 const program=ts.createProgram([file],options,host);
 return ts.getPreEmitDiagnostics(program).map(d=>({code:d.code,file:d.file?.fileName.replaceAll('\\','/').split('/ASA-lab/').at(-1),message:ts.flattenDiagnosticMessageText(d.messageText,'\n')})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
const baseline=diagnostics(before), candidate=diagnostics();
const result={ classification:'ad hoc spec typecheck; existing baseline diagnostics preserved, not canonical gate PASS', identical:JSON.stringify(baseline)===JSON.stringify(candidate), baseline,candidate };
writeFileSync(new URL('typecheck-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({identical:result.identical,baseline:baseline.length,candidate:candidate.length}));
if(!result.identical)process.exitCode=1;
