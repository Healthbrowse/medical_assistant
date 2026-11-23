import test from 'node:test';
import assert from 'node:assert/strict';
import {runRedTeam,redTeamMarkdown} from '../qa/red-team.mjs';
test('red-team matrix protects both modes and entry points while admitting ordinary medical education',async()=>{
 const report=await runRedTeam();
 assert.equal(report.summary.failed,0,JSON.stringify(report.records.filter(r=>!r.passed),null,2));
 assert.equal(report.summary.externalCalls,0);
 assert.match(redTeamMarkdown(report),/Local deterministic regression/);
});
