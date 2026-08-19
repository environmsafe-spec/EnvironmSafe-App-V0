/* Duplicate guard on the daily transaction entry: warn before recording a
   transaction that looks like one already in the books. Nothing is blocked. */
const fs=require('fs'), vm=require('vm'), path=require('path');
const file=process.argv[2]||path.join(__dirname,'web','index.html');
const SOURCE=fs.readFileSync(file,'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
// Only the duplicate guard is under test, so pull that block out and give it the
// few helpers the app defines elsewhere.
const BLOCK=SOURCE.match(/const DUP_DAYS[\s\S]*?\n}\n\n\/\*\* The confirm[\s\S]*?\n}\n/)[0];
let pass=0,fail=0;
function check(l,c,d){ if(c){pass++;console.log('  PASS  '+l);} else {fail++;console.log('  FAIL  '+l+(d?'  -> '+d:''));} }

const sb={console,Date,Math,String,Number,Array,Object,isNaN,parseFloat,
  num: v=>{const n=parseFloat(v);return isFinite(n)?n:0;},
  fmt: v=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
  amountOf: tx=>(parseFloat(tx.debit)||0)+(parseFloat(tx.credit)||0),
  nameOf: (tbl,id)=>({c1:'Ministry of Health',s1:'Aden Trading'})[id]||'',
  LANG:'en', DB:{transactions:[]}};
vm.createContext(sb);
vm.runInContext(BLOCK, sb);
const run=c=>vm.runInContext(c,sb);

sb.DB.transactions=[
  {id:'TRX-1001',date:'2026-08-17',type:'INVOICE OUT',customerId:'c1',supplierId:'',employeeId:'',
   debit:250000,credit:0,currency:'YER',refNo:'INV-1024'},
  {id:'TRX-1002',date:'2026-08-17',type:'EXPENSE',customerId:'',supplierId:'s1',employeeId:'',
   debit:0,credit:15000,currency:'YER',refNo:''},
  {id:'TRX-1003',date:'2026-08-01',type:'INVOICE OUT',customerId:'c1',supplierId:'',employeeId:'',
   debit:250000,credit:0,currency:'YER',refNo:'INV-1000'}
];
const cand=(o)=>Object.assign({date:'2026-08-18',type:'INVOICE OUT',amount:250000,refNo:'',
  customerId:'c1',supplierId:'',employeeId:''},o);

console.log('\n=== What counts as a near-duplicate ===');
check('same type, party and amount a day later is flagged',
      run('similarTransactions('+JSON.stringify(cand())+').length')===1);
check('... and it points at the entry that matches',
      run('similarTransactions('+JSON.stringify(cand())+')[0].id')==='TRX-1001');
check('a different amount is not flagged',
      run('similarTransactions('+JSON.stringify(cand({amount:90000}))+').length')===0);
check('a rounding difference under 1% still counts as the same amount',
      run('similarTransactions('+JSON.stringify(cand({amount:250500}))+').length')===1);
check('a different customer is not flagged',
      run('similarTransactions('+JSON.stringify(cand({customerId:'c2'}))+').length')===0);
check('a different transaction type is not flagged',
      run('similarTransactions('+JSON.stringify(cand({type:'PAYMENT IN'}))+').length')===0);
check('the same entry two weeks later is not flagged',
      run('similarTransactions('+JSON.stringify(cand({date:'2026-09-05'}))+').length')===0);
check('a repeated reference number is flagged whatever the date or amount',
      run('similarTransactions('+JSON.stringify(cand({date:'2026-12-01',amount:5,refNo:'INV-1024'}))+').length')===1);
check('reference matching ignores case and spacing',
      run('similarTransactions('+JSON.stringify(cand({date:'2026-12-01',amount:5,refNo:' inv-1024 '}))+').length')===1);
check('a blank reference never matches other blank references',
      run('similarTransactions('+JSON.stringify({date:'2026-08-18',type:'EXPENSE',amount:99999,refNo:'',customerId:'',supplierId:'s1',employeeId:''})+').length')===0);
check('editing an entry does not match itself',
      run('similarTransactions('+JSON.stringify(cand({id:'TRX-1001',date:'2026-08-17'}))+').length')===0);
check('an entry with no party still matches another with no party',
      run(`similarTransactions({date:'2026-08-18',type:'EXPENSE',amount:15000,refNo:'',customerId:'',supplierId:'s1',employeeId:''}).length`)===1);

console.log('\n=== The message the user sees ===');
let msg=run('duplicateTxWarning('+JSON.stringify(cand())+')');
check('names the existing transaction', msg.indexOf('TRX-1001')>=0, msg);
check('shows its date', msg.indexOf('2026-08-17')>=0, msg);
check('shows its amount', msg.indexOf('250,000.00')>=0, msg);
check('shows the party', msg.indexOf('Ministry of Health')>=0, msg);
check('ends with a continue question', /continue and save it anyway/.test(msg), msg);
check('counts the other close entries',
      run(`(function(){DB.transactions.push({id:'TRX-1004',date:'2026-08-18',type:'INVOICE OUT',customerId:'c1',supplierId:'',employeeId:'',debit:250000,credit:0,currency:'YER',refNo:''});
           var m=duplicateTxWarning(`+JSON.stringify(cand())+`);DB.transactions.pop();return m;})()`).indexOf('1 other close')>=0);
check('nothing similar means no warning at all',
      run(`duplicateTxWarning({date:'2026-08-18',type:'PAYMENT OUT',amount:777,refNo:'',customerId:'',supplierId:'',employeeId:''})`)==='');
check('the warning follows the Arabic setting',
      run(`(function(){LANG='ar';var m=duplicateTxWarning(`+JSON.stringify(cand())+`);LANG='en';return m;})()`).indexOf('هل تريد المتابعة')>=0);

console.log('\n=== No bank account numbers left in the file ===');
const html=fs.readFileSync(file,'utf8');
check('the company defaults ship no account number', !/Account No:\s*\d/.test(html));
check('the two real account numbers are gone', html.indexOf('3108401426')<0 && html.indexOf('436323')<0);

console.log('\nTOTAL: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
