import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {HistoryView} from "@/components/fv/HistoryScreen";
import {buildContribution} from "@/lib/completions";
describe("accepted reward receipts in History",()=>{
 it("shows the stored total once, including its already included streak bonus",()=>{
  const mine=[{points:11,streakBonus:1},{points:12,streakBonus:2},{points:7,streakBonus:2}].map((r,i)=>buildContribution({...r,taskId:`t${i}`,description:"TEST DATA accepted work",proofImageUrl:null,proofNote:null,campaignId:i===2?"first-favour":"draft_fixture",now:Date.UTC(2026,9,25)}));
  const html=renderToStaticMarkup(<HistoryView mine={mine} stats={{}} signedIn={true} error={null} latest={[]}/>).replaceAll("<!-- -->","");
  expect(html).toContain('>30</span> pts');
  expect(html).not.toContain('>35</span> pts');
  for(const n of [11,12,7])expect(html).toContain(`+${n}</p>`);
  expect(html).toContain('/?campaign=welcome');
  expect(html).toContain('/?campaign=draft_fixture');
 });
});
