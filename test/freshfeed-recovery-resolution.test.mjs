import test from 'node:test';
import assert from 'node:assert/strict';
import { freshfeedView } from '../card/freshfeed-model.js';
const config = {freshfeed:{write_status_entity:'w',quick_feed_entity:'q'}};
const resolution = {operation_id:'cancel-op',session_id:'session',operation:'cancel',outcome:'abandoned'};
test('bounded recovery resolution preserves unknown and rejects malformed metadata',()=>{
  const view = value => freshfeedView(config,{states:{w:{state:'idle',attributes:{recovery_resolution:value}},q:{state:'unknown',attributes:{}}}});
  assert.deepEqual(view(resolution).recoveryResolution,{operationId:'cancel-op',sessionId:'session',operation:'cancel',outcome:'abandoned'});
  assert.equal(view(resolution).quickFeed.status,null);
  for(const value of [null,[],{}, {...resolution,outcome:'verified'}, {...resolution,operation_id:''}, {...resolution,extra:true}]) {
    assert.equal(view(value).recoveryResolution,null);
    assert.equal(view(value).recoveryResolutionPresent,true);
  }
  assert.equal(freshfeedView(config,{states:{}}).recoveryResolutionPresent,false);
});
