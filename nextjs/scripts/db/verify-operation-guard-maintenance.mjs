import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

if (process.env.LOCAL_OPERATION_GUARD_TEST !== '1') throw new Error('Local rehearsal opt-in required');
const port = process.env.PGPORT || '54322';
if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid loopback test port');
const binary = process.env.PSQL_BIN || 'psql';
function sql(query) {
  return execFileSync(binary, ['-X','-qAt','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],
    {encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();
}
const expected='select public.prune_foundation_operations(); select public.prune_foundation_contact_limits();';
const job=JSON.parse(sql("select row_to_json(j) from (select jobid,schedule,command,active,database,username from cron.job where jobname='tavonel-operation-guard-prune') j;"));
assert.equal(job.schedule,'* * * * *');assert.equal(job.command,expected);assert.equal(job.active,true);
assert.equal(job.database,'postgres');assert.equal(job.username,'postgres');
const workspace='maintenance-test-'+randomUUID();
const owner=randomUUID();
const previousRun=Number(sql(`select coalesce(max(runid),0) from cron.job_run_details where jobid=${Number(job.jobid)};`));
try {
  assert.equal(sql(`insert into public.foundation_operation_leases(workspace_key,operation_scope,owner_token,state,expires_at)
    values('${workspace}','ask','${owner}','running',now()-interval '1 minute') returning owner_token;`),owner);
  // No direct prune call here: only the installed scheduler can remove the witness.
  const start=Date.now();
  let removed=false;
  while(Date.now()-start<90000) {
    await new Promise(resolve=>setTimeout(resolve,2000));
    const absent=sql(`select count(*) from public.foundation_operation_leases where workspace_key='${workspace}';`)==='0';
    const successful=Number(sql(`select count(*) from cron.job_run_details where jobid=${Number(job.jobid)} and runid>${previousRun} and status='succeeded';`))>0;
    if(absent && successful) {removed=true;break;}
  }
  assert.equal(removed,true,'Configured scheduler did not actually remove an expired lease');
  const successful=sql(`select count(*) from cron.job_run_details where jobid=${Number(job.jobid)} and runid>${previousRun} and status='succeeded';`);
  assert.ok(Number(successful)>0,'No successful scheduler execution receipt');
  console.log(JSON.stringify({status:'PASS',scope:'disposable loopback PostgreSQL only',job:'tavonel-operation-guard-prune',cadence:job.schedule,expiredWitnessRemoved:true,recentSuccessfulRun:true}));
} finally {
  sql(`delete from public.foundation_operation_leases where workspace_key='${workspace}' and owner_token='${owner}';`);
}
