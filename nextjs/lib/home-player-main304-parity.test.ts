import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import CompileStagePlayer from "../components/compile-stage-player";
const baseline=JSON.parse(readFileSync(new URL("../scripts/fixtures/home-player-main304-ssr.json",import.meta.url),"utf8")) as {base:string;fixtures:{name:string;props:{compact?:boolean;korean?:boolean};html:string}[]};
describe("non-Home markup stays exact main304",()=>{
 for(const fixture of baseline.fixtures)it(fixture.name,()=>{
  expect(baseline.base).toBe("3041327e9128258a3dab4f6f3ba6e5d274672ae5");
  expect(renderToStaticMarkup(createElement(CompileStagePlayer,fixture.props))).toBe(fixture.html);
  expect(renderToStaticMarkup(createElement(CompileStagePlayer,{...fixture.props,storyLayout:false}))).toBe(fixture.html);
 });
});
