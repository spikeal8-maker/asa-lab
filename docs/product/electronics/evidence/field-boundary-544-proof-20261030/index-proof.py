import copy, hashlib, json, pathlib, re

root = pathlib.Path(__file__).parent
artifact = root / 'artifact'
cases = []
for path in sorted(artifact.rglob('field-boundary.json')):
    d = json.loads(path.read_text(encoding='utf-8'))
    rs = {r['phase']: r for r in d['receipts']}
    first = rs['closed-panel-mouse-after']['local']
    saved = rs['saved']['extra']
    final = rs['complete']['extra']['final']
    expected = copy.deepcopy(d['fixture'])
    grabbed = next(c for c in first['components'] if c['id'] == 'field-source')
    for c in expected['components']:
        if c['id'] == 'field-source':
            c['position'] = grabbed['position']; c['holeBindings'] = {}
    again = copy.deepcopy(saved['draft']['document'])
    for c in again['components']:
        if c['id'] == 'field-source':
            c['position'] = next(c for c in final['components'] if c['id']=='field-source')['position']
    checks = {
        'fixture_equals_baseline': d['fixture'] == d['baseline']['draft']['document'],
        'first_whole_document': first == expected,
        'PUT_document_and_CAS': any(q['document']==first and q['baseRevision']==d['baseline']['draft']['revision'] for q in d['requests']),
        'saved_whole_document': saved['draft']['document']==first,
        'revision_advanced': saved['draft']['revision']>d['baseline']['draft']['revision'],
        'cookies_only_no_local_draft': rs['open-panel-reopened-before']['local'] is None,
        'complete_confirmed_document': rs['complete']['extra']['confirmed']['draft']['document']==saved['draft']['document'],
        'regrab_whole_document': final==again,
        'regrab_changed_position': final!=first,
        'fixture_4_parts_3_wires': len(first['components'])==4 and len(first['connections'])==3,
    }
    for prefix in ['closed-panel-mouse', 'open-panel-reopened']:
        before, after = rs[prefix+'-before'], rs[prefix+'-after']
        events = after['extra']['events']
        checks[prefix+'_opaque255'] = before['extra']['point']['opaqueCentreAlpha']==255
        checks[prefix+'_trusted_down_up'] = all(any(e['type']==t and e['trusted'] for e in events) for t in ['pointerdown','pointerup'])
    files = [path] + sorted(path.parent.glob('*.png'))
    checks['all7_phase_png'] = len(files)==8
    assert all(checks.values()), (d['width'], d['boundary'], checks)
    cases.append({'width':d['width'],'boundary':d['boundary'],'checks':checks,'baselineRevision':d['baseline']['draft']['revision'],'savedRevision':saved['draft']['revision'],'files':[{'path':str(p.relative_to(root)), 'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]})
assert len(cases)==32 and len({(c['width'],c['boundary']) for c in cases})==32
index={'head':'e1be12d19f8669c1145020c756551dd2188ed10f','run':41026543811,'artifact':12965392403,'fieldCases':cases,'fieldCount':len(cases),'phasePngCount':sum(len(c['files'])-1 for c in cases),'workflowConclusion':'failure','browserPassed':183,'browserFailed':86,'classification':'C: independent existing baseline failures, proof-only zero source diff','archive':'full extracted artifact retained locally; original remote artifact digest in artifact-metadata.json; original ZIP not separately downloaded'}
(root/'field32-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf-8')
lines=(root/'browser.log').read_text(encoding='utf-8-sig').splitlines()
failed=[l.split('Z ',1)[-1].strip() for l in lines if re.search(r'Z\s+\d+\) e2e/',l)]
assert len(failed)==86,len(failed)
(root/'failed86.txt').write_text('\n'.join(failed)+'\n\nFirst failure: issue682 short20 timing acceptance expected []; actual edge-lateness/period/phase-duration diagnostic violations (e2e/electronics-interactions.spec.ts:1292:35). No source edits or retry.\n',encoding='utf-8')
print(json.dumps({'fieldCases':32,'checksPerCase':len(cases[0]['checks']),'phasePNGs':index['phasePngCount'],'failedNames':len(failed),'index':str(root/'field32-index.json')}))

