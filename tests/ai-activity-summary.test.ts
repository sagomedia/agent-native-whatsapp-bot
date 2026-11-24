import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {activitySummary} from '../apps/dashboard/src/ai-activity-summary.js';

test('activity summaries explain saved names in English and Tamil',()=>{
 const item={changes:[{field:'aliases',before:['plier','old'],after:['plier','கட்டிங் பிளையர்']}]};
 assert.deepEqual(activitySummary(item,'en'),['I added “கட்டிங் பிளையர்” as another name for this product.',"I removed “old” from this product's names."]);
 assert.deepEqual(activitySummary(item,'ta'),['இந்தப் பொருளுக்கு “கட்டிங் பிளையர்”ன்னு இன்னொரு பெயர் சேர்த்தேன்.','இந்தப் பொருளின் பெயர்களில் “old” நீக்கினேன்.']);
});
test('review proposals and hidden products are not described as applied or deleted',()=>{
 const patch={aliases:{add:['cutter'],remove:[]},keywords:{add:[],remove:[]}};
 assert.match(activitySummary({patch},'en',true)[0],/^Suggested:/);
 assert.match(activitySummary({changes:[{field:'active',before:true,after:false}]},'en')[0],/Hid/);
});
test('historical and unknown changes do not invent details',()=>{
 assert.match(activitySummary({historical:true,action:'add_product'},'en')[0],/Earlier details are unavailable/);
 assert.match(activitySummary({},'ta')[0],/பதிவாகியுள்ளது/);
});
test('price and stock summaries include recorded values and bound large lists',()=>{
 assert.match(activitySummary({changes:[{field:'price_paise',before:10000,after:12550}]},'en')[0],/₹100\.00 to ₹125\.50/);
 assert.match(activitySummary({changes:[{field:'stock',before:3,after:9}]},'ta')[0],/3 → 9/);
 const result=activitySummary({changes:[{field:'aliases',before:[],after:['one','two','three','four']}]},'en')[0];
 assert.match(result,/\+2/);assert.doesNotMatch(result,/three|four/);
});
