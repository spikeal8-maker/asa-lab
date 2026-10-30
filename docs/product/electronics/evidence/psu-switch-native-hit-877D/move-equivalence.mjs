import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const parent='3a9b3e1d97c370e650d8a895e488897c2a455d07';
const stagePath='apps/web/src/electronics/WorkbenchStage.tsx';
const old=execFileSync('git',['show',`${parent}:${stagePath}`],{encoding:'utf8'});
const stage=readFileSync(stagePath,'utf8');const helperPath='apps/web/src/electronics/supply-switch-hit-geometry.ts';const helper=readFileSync(helperPath,'utf8');
function tokens(s){const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,s),out=[];while(scanner.scan()!==ts.SyntaxKind.EndOfFileToken)out.push(scanner.getTokenText());return out;}
const begin='  const supplySwitchHoles =';const end='  const badgeGeometry =';
const normalized=old.slice(old.indexOf(begin),old.indexOf(end)).replaceAll('c.pendingTerminal','pendingTerminal').replaceAll('paintedComponentPoint(','projectPoint(').replaceAll('paintedComponentBounds(','projectBounds(').replace('  const hitDomainPoints = routedWires.flatMap(({ points }) => points);\n','').replace('  const stageBounds = c.stageRef.current?.getBoundingClientRect();\n','').replaceAll('c.viewBox','viewBox');
const moved=helper.slice(helper.indexOf(begin),helper.indexOf('  return { switchClips, hitDomain };'));
assert.deepEqual(tokens(moved),tokens(normalized),'moved geometry tokens/control flow identical after explicit parameter substitutions');
assert.equal(stage.slice(stage.indexOf(end)),old.slice(old.indexOf(end)),'remaining Stage body/native handlers/JSX bytes unchanged');
const oldPrefix=old.slice(0,old.indexOf('  // Bounds overlap conservatively'));
const newPrefix=stage.slice(0,stage.indexOf('  const bodyPaintOrder')).replace("import { computeSupplySwitchClipGeometry } from './supply-switch-hit-geometry';\n",'');
assert.equal(newPrefix,oldPrefix,'Stage prefix canonical projections/readiness/handlers unchanged');
assert.deepEqual(tokens(stage.slice(stage.indexOf('  const bodyPaintOrder'),stage.indexOf('  const { switchClips'))),tokens(old.slice(old.indexOf('  const bodyPaintOrder'),old.indexOf(begin))));
const retained=['apps/web/src/electronics/ProductionComponentVisual.tsx','e2e/electronics-simulation.spec.ts','docs/product/electronics/generated/component-coverage.json'];const unchangedGitBlobs={};
for(const path of retained){const expected=execFileSync('git',['rev-parse',`${parent}:${path}`],{encoding:'utf8'}).trim();assert.equal(execFileSync('git',['hash-object',path],{encoding:'utf8'}).trim(),expected);unchangedGitBlobs[path]=expected;}
const result={parent,movedGeometryTokensEqual:true,parameterSubstitutions:['pendingTerminal','projectPoint','projectBounds','viewBox','hitDomainPoints','stageBounds'],canonicalStagePrefixAndSuffixUnchanged:true,bodyPaintOrderUnchanged:true,unchangedGitBlobs,geometryTokenSha256:createHash('sha256').update(JSON.stringify(tokens(moved))).digest('hex'),sizes:{oldStageGitBytes:Buffer.byteLength(old),stageWorkingBytes:statSync(stagePath).size,stageLfBytes:Buffer.byteLength(stage.replaceAll('\r\n','\n')),helperBytes:statSync(helperPath).size,reviewedBytes:54879,ceilingBytes:54879*1.2},runningFrameProofReuse:'Previous actual Worker proof remains supplemental; control-flow equivalence proves no readiness/subscription change. Fresh91 native Stage proof supplied; no new actual Worker run claimed.'};
assert.ok(result.sizes.stageWorkingBytes<=result.sizes.ceilingBytes);assert.ok(result.sizes.helperBytes<50000);
writeFileSync(new URL('move-equivalence.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
