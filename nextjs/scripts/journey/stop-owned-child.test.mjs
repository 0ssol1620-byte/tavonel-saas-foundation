import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { stopOwnedChild } from "./stop-owned-child.mjs";

test("stops the owned real process and leaves an independent process running", async () => {
  const children = [0,1].map(() => spawn(process.execPath,["-e","setInterval(()=>{},1000);console.log('ready')"],{stdio:["ignore","pipe","ignore"]}));
  try {
    await Promise.all(children.map(child => once(child.stdout,"data")));
    await stopOwnedChild(children[0],{graceMs:500,forceMs:500});
    assert.ok(children[0].exitCode!==null||children[0].signalCode!==null);
    assert.equal(children[1].exitCode,null);assert.equal(children[1].signalCode,null);
    await stopOwnedChild(children[0]); // Repeated cleanup is safe.
  } finally { await Promise.all(children.map(child=>stopOwnedChild(child))); }
});

test("forces only the owned real process when it ignores SIGTERM", {skip:process.platform==="win32"}, async () => {
  const child=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('ready')"],{stdio:["ignore","pipe","ignore"]});
  try {
    await once(child.stdout,"data");await stopOwnedChild(child,{graceMs:50,forceMs:1000});
    assert.equal(child.signalCode,"SIGKILL");
  } finally {await stopOwnedChild(child);}
});
