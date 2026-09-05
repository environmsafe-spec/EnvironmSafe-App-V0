// Re-implements the app's own posting rules and runs them over the converted file.
const fs=require('fs'); const db=JSON.parse(fs.readFileSync('environmsafe-import.json','utf8'));
const T=[["INVOICE OUT","credit","revenue"],["RECEIPT","credit","cash_in"],
 ["EXPENSE","debit","cost_cash_out"],["SALARY","debit","cost_cash_out"],
 ["OWNER DRAWINGS","debit","cash_out"],["TRANSFER IN","credit","cash_in"],
 ["TRANSFER OUT","debit","cash_out"],["DEPOSIT PAID","debit","cash_out"],
 ["DEPOSIT RETURNED","credit","cash_in"]];
const flow=t=>(T.find(x=>x[0]===t)||[])[2]||"";
const side=t=>(T.find(x=>x[0]===t)||[])[1]||"";
const amt=x=>(+x.debit||0)+(+x.credit||0);
const isRevenue=x=>flow(x.type)==="revenue", isCashIn=x=>flow(x.type)==="cash_in";
const isCashOut=x=>["cash_out","cost_cash_out"].includes(flow(x.type));
const isCost=x=>flow(x.type)==="cost"||flow(x.type)==="cost_cash_out";

let bad=0;
db.transactions.forEach(x=>{ // the amount must sit on the side the app would use
  const s=side(x.type); const wrong=(s==="debit"&&+x.credit>0)||(s==="credit"&&+x.debit>0);
  if(wrong){bad++; if(bad<4)console.log("  side mismatch:",x.id,x.type,x.debit,x.credit);}
});
console.log("posting-side mismatches:",bad);

const cur=[...new Set(db.transactions.map(x=>x.currency))].sort();
console.log("\n            revenue         cost      cash in     cash out      net cash");
for(const c of cur){
  const L=db.transactions.filter(x=>x.currency===c);
  const f=p=>L.filter(p).reduce((s,x)=>s+amt(x),0);
  const rev=f(isRevenue), cost=f(isCost), ci=f(isCashIn), co=f(isCashOut);
  console.log(`${c}  ${rev.toLocaleString(undefined,{minimumFractionDigits:2}).padStart(13)}`+
    `${cost.toLocaleString(undefined,{minimumFractionDigits:2}).padStart(13)}`+
    `${ci.toLocaleString(undefined,{minimumFractionDigits:2}).padStart(13)}`+
    `${co.toLocaleString(undefined,{minimumFractionDigits:2}).padStart(13)}`+
    `${(ci-co).toLocaleString(undefined,{minimumFractionDigits:2}).padStart(14)}`);
}

// customer balances: invoices − receipts, exactly as the statement computes
console.log("\ntop customer balances (invoiced − received):");
const byC={};
db.transactions.forEach(x=>{ if(!x.customerId) return;
  const k=x.customerId+"|"+x.currency; byC[k]=byC[k]||0;
  if(isRevenue(x)) byC[k]+=amt(x); else if(isCashIn(x)) byC[k]-=amt(x); });
const name=id=>(db.customers.find(c=>c.id===id)||{}).nameEn||id;
Object.entries(byC).filter(([,v])=>Math.abs(v)>0.005)
  .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,10)
  .forEach(([k,v])=>{const[id,c]=k.split("|");
    console.log(`   ${name(id).padEnd(24)} ${c} ${v.toLocaleString(undefined,{minimumFractionDigits:2}).padStart(16)}`);});

// account balances
console.log("\naccount balances (cash in − cash out):");
const byA={};
db.transactions.forEach(x=>{ if(!x.accountId) return;
  byA[x.accountId]=byA[x.accountId]||0;
  if(isCashIn(x)) byA[x.accountId]+=amt(x); else if(isCashOut(x)) byA[x.accountId]-=amt(x); });
db.accounts.forEach(a=>{ const v=byA[a.id]||0; if(Math.abs(v)>0.005)
  console.log(`   ${a.nameEn.padEnd(16)} ${a.currency} ${v.toLocaleString(undefined,{minimumFractionDigits:2}).padStart(16)}`);});

const noDate=db.transactions.filter(x=>!x.date).length;
const noAcc=db.transactions.filter(x=>!x.accountId).length;
console.log(`\nrows without a date: ${noDate}   without an account: ${noAcc}`);
console.log(`date range: ${db.transactions.filter(x=>x.date).map(x=>x.date).sort()[0]} .. ${db.transactions.filter(x=>x.date).map(x=>x.date).sort().pop()}`);

// --- every movement leg should have a partner, and the pair should net to zero ---
const legs=db.transactions.filter(x=>/^TRANSFER /.test(x.type));
const byId=Object.fromEntries(db.transactions.map(x=>[x.id,x]));
let broken=0, netted=0;
legs.forEach(x=>{ if(!x.againstRef) return;
  const p=byId[x.againstRef];
  if(!p||p.againstRef!==x.id){broken++;return;}
  if(Math.round(amt(p)*100)===Math.round(amt(x)*100)) netted++; });
console.log(`\nmovement legs: ${legs.length}, paired both ways: ${netted}, broken links: ${broken}, ` +
            `unpaired: ${legs.filter(x=>!x.againstRef).length}`);

// --- the converted view: everything in USD at the row's own rate ---
const usd=x=>amt(x)/(+x.fxRate||1);
const F=p=>db.transactions.filter(p).reduce((s,x)=>s+usd(x),0);
console.log("\nconverted to USD (the 'All → USD' view):");
console.log("  revenue  "+F(isRevenue).toLocaleString(undefined,{maximumFractionDigits:0}).padStart(12));
console.log("  cost     "+F(isCost).toLocaleString(undefined,{maximumFractionDigits:0}).padStart(12));
console.log("  cash in  "+F(isCashIn).toLocaleString(undefined,{maximumFractionDigits:0}).padStart(12));
console.log("  cash out "+F(isCashOut).toLocaleString(undefined,{maximumFractionDigits:0}).padStart(12));
const missing=db.transactions.filter(x=>!(+x.fxRate>0)).length;
console.log("  rows with no rate: "+missing);
