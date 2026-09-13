import { afterAll, describe, expect, it } from 'vitest';
import { assignmentDateTime } from './assignment-date-time';
const originalZone = process.env['TZ'];
afterAll(()=>{if(originalZone===undefined)delete process.env['TZ'];else process.env['TZ']=originalZone;});
describe('assignment wall time uses the displayed IANA zone',()=>{
  it('preserves no deadline and rejects incomplete input',()=>{
    expect(assignmentDateTime('')).toMatchObject({ok:true,instant:null});
    expect(assignmentDateTime('2026-09-30')).toMatchObject({ok:false});
  });
  it('rejects calendar overflow',()=>{
    expect(assignmentDateTime('2026-02-30T12:00')).toMatchObject({ok:false});
  });
  it('stores the same instant across day boundaries rather than the server zone',()=>{
    process.env['TZ']='Europe/Moscow';
    expect(assignmentDateTime('2026-09-30T00:30')).toEqual({ok:true,instant:'2026-09-29T21:30:00.000Z',timeZone:'Europe/Moscow'});
  });
  it('refuses both nonexistent spring time and repeated fall time',()=>{
    process.env['TZ']='America/New_York';
    expect(assignmentDateTime('2026-03-08T02:30')).toMatchObject({ok:false});
    expect(assignmentDateTime('2026-11-01T01:30')).toMatchObject({ok:false});
    expect(assignmentDateTime('2026-11-01T03:00')).toEqual({ok:true,instant:'2026-11-01T08:00:00.000Z',timeZone:'America/New_York'});
  });
});
