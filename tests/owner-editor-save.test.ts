import {test} from 'node:test';
import assert from 'node:assert/strict';
import {persistEditorDraft,prepareProductClone,copyEditorPhoto} from '../apps/dashboard/src/owner-editor-save.js';

test('photo failure retains unsaved protection even after draft details are persisted, then retry can finish',async()=>{
 const state={dirty:true,draftVersion:1,photo:'pending'};
 await assert.rejects(persistEditorDraft(async()=>{state.draftVersion=2;return {version:2};},async()=>{throw new Error('Upload failed');},()=>{state.dirty=false;state.photo='saved';}),/Upload failed/);
 assert.deepEqual(state,{dirty:true,draftVersion:2,photo:'pending'});
 await persistEditorDraft(async()=>({version:state.draftVersion}),async draft=>{assert.equal(draft.version,2);return {version:3};},draft=>{state.draftVersion=draft.version;state.dirty=false;state.photo='saved';});
 assert.deepEqual(state,{dirty:false,draftVersion:3,photo:'saved'});
});
test('failed draft details never attempt the pending photo or mark the editor clean',async()=>{
 let uploads=0,completed=false;
 await assert.rejects(persistEditorDraft(async()=>{throw new Error('Version conflict');},async draft=>{uploads++;return draft;},()=>{completed=true;}),/Version conflict/);
 assert.equal(uploads,0);assert.equal(completed,false);
});
test('cloning a staged edit breaks product and proposal identity and invalidates all merchant evidence',()=>{
 const source={sku:'PIPE-1',createId:'original-create-id',version:7,inventoryVersion:12,active:true,verified:true,verification:{identity:true,photo:true,sellingUnit:true,price:true,stock:true},name:'PVC 1 inch',price:'180',unit:'piece'};
 const clone=prepareProductClone(source,'fresh-create-id');
 assert.equal(clone.proposal,null);assert.equal(clone.selectedProduct,null);assert.equal(clone.draftAsset,'');assert.equal(clone.withoutPhoto,false);
 assert.deepEqual(clone.form,{...source,sku:'',createId:'fresh-create-id',version:0,inventoryVersion:undefined,active:false,verified:false,verification:{identity:false,photo:false,sellingUnit:false,price:false,stock:false}});
 assert.equal(source.sku,'PIPE-1');assert.equal(source.verification.photo,true);
});
test('normalized owner draft photos are copied with their real media type before clone identity changes',async()=>{
 const url='/api/owner/catalog/proposals/source/photos/exact-photo';
 const photo=await copyEditorPhoto(url,'fresh-photo-id',async(src,options)=>{assert.equal(src,url);assert.equal(options?.cache,'no-store');return new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});});
 assert.equal(photo.id,'fresh-photo-id');assert.equal(photo.mimeType,'image/png');assert.deepEqual([...Buffer.from(photo.data,'base64')],[137,80,78,71]);
 await assert.rejects(copyEditorPhoto(url,'id',async()=>new Response('',{status:404})),/Could not copy/);
 await assert.rejects(copyEditorPhoto(url,'id',async()=>new Response(new Uint8Array(2097153),{headers:{'content-type':'image/jpeg'}})),/under 2 MB/);
});
