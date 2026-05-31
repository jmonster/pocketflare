import{d as $t,E as qt,U as Tt,S as St,z as ce,a as Ct,w as o,u as $e,a3 as he,a2 as ve,V as se,a4 as Ve,t as pt,D as Pt,N as Mt,l as Lt,G as r,i,K as qe,x as s,_ as m,Z as p,s as Te,j as w,b as we,P as Ft,a0 as Se,J as Ot,y as Ht,L as fe}from"./index-DiFYKP__.js";import{F as Rt}from"./FieldsQueryParam-Dol1zKfT.js";function bt(a,e,t){const l=a.slice();return l[10]=e[t],l}function mt(a,e,t){const l=a.slice();return l[10]=e[t],l}function _t(a,e,t){const l=a.slice();return l[15]=e[t],l}function kt(a){let e;return{c(){e=s("p"),e.innerHTML="Requires superuser <code>Authorization:TOKEN</code> header",w(e,"class","txt-hint txt-sm txt-right")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function yt(a){let e,t,l,c,f,u,_,b,q,y,g,B,S,$,R,M,U,D,P,z,L,T,k,F,ee,Q,I,oe,G,W,Y;function ue(h,C){var V,K,H;return C&1&&(u=null),u==null&&(u=!!((H=(K=(V=h[0])==null?void 0:V.fields)==null?void 0:K.find(Yt))!=null&&H.required)),u?Bt:At}let te=ue(a,-1),E=te(a);function Z(h,C){var V,K,H;return C&1&&(U=null),U==null&&(U=!!((H=(K=(V=h[0])==null?void 0:V.fields)==null?void 0:K.find(Wt))!=null&&H.required)),U?Vt:Nt}let X=Z(a,-1),O=X(a);return{c(){e=s("tr"),e.innerHTML='<td colspan="3" class="txt-hint txt-bold">Auth specific fields</td>',t=p(),l=s("tr"),c=s("td"),f=s("div"),E.c(),_=p(),b=s("span"),b.textContent="email",q=p(),y=s("td"),y.innerHTML='<span class="label">String</span>',g=p(),B=s("td"),B.textContent="Auth record email address.",S=p(),$=s("tr"),R=s("td"),M=s("div"),O.c(),D=p(),P=s("span"),P.textContent="emailVisibility",z=p(),L=s("td"),L.innerHTML='<span class="label">Boolean</span>',T=p(),k=s("td"),k.textContent="Whether to show/hide the auth record email when fetching the record data.",F=p(),ee=s("tr"),ee.innerHTML='<td><div class="inline-flex"><span class="label label-success">Required</span> <span>password</span></div></td> <td><span class="label">String</span></td> <td>Auth record password.</td>',Q=p(),I=s("tr"),I.innerHTML='<td><div class="inline-flex"><span class="label label-success">Required</span> <span>passwordConfirm</span></div></td> <td><span class="label">String</span></td> <td>Auth record password confirmation.</td>',oe=p(),G=s("tr"),G.innerHTML=`<td><div class="inline-flex"><span class="label label-warning">Optional</span> <span>verified</span></div></td> <td><span class="label">Boolean</span></td> <td>Indicates whether the auth record is verified or not.
                    <br/>
                    This field can be set only by superusers or auth records with &quot;Manage&quot; access.</td>`,W=p(),Y=s("tr"),Y.innerHTML='<td colspan="3" class="txt-hint txt-bold">Other fields</td>',w(f,"class","inline-flex"),w(M,"class","inline-flex")},m(h,C){r(h,e,C),r(h,t,C),r(h,l,C),i(l,c),i(c,f),E.m(f,null),i(f,_),i(f,b),i(l,q),i(l,y),i(l,g),i(l,B),r(h,S,C),r(h,$,C),i($,R),i(R,M),O.m(M,null),i(M,D),i(M,P),i($,z),i($,L),i($,T),i($,k),r(h,F,C),r(h,ee,C),r(h,Q,C),r(h,I,C),r(h,oe,C),r(h,G,C),r(h,W,C),r(h,Y,C)},p(h,C){te!==(te=ue(h,C))&&(E.d(1),E=te(h),E&&(E.c(),E.m(f,_))),X!==(X=Z(h,C))&&(O.d(1),O=X(h),O&&(O.c(),O.m(M,D)))},d(h){h&&(o(e),o(t),o(l),o(S),o($),o(F),o(ee),o(Q),o(I),o(oe),o(G),o(W),o(Y)),E.d(),O.d()}}}function At(a){let e;return{c(){e=s("span"),e.textContent="Optional",w(e,"class","label label-warning")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function Bt(a){let e;return{c(){e=s("span"),e.textContent="Required",w(e,"class","label label-success")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function Nt(a){let e;return{c(){e=s("span"),e.textContent="Optional",w(e,"class","label label-warning")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function Vt(a){let e;return{c(){e=s("span"),e.textContent="Required",w(e,"class","label label-success")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function jt(a){let e;return{c(){e=s("span"),e.textContent="Required",w(e,"class","label label-success")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function Jt(a){let e;return{c(){e=s("span"),e.textContent="Optional",w(e,"class","label label-warning")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function Dt(a){let e,t=a[15].maxSelect===1?"id":"ids",l,c;return{c(){e=m("Relation record "),l=m(t),c=m(".")},m(f,u){r(f,e,u),r(f,l,u),r(f,c,u)},p(f,u){u&32&&t!==(t=f[15].maxSelect===1?"id":"ids")&&se(l,t)},d(f){f&&(o(e),o(l),o(c))}}}function Et(a){let e,t,l,c,f,u,_,b,q;return{c(){e=m("File object."),t=s("br"),l=m(`
                        Set to empty value (`),c=s("code"),c.textContent="null",f=m(", "),u=s("code"),u.textContent='""',_=m(" or "),b=s("code"),b.textContent="[]",q=m(`) to delete
                        already uploaded file(s).`)},m(y,g){r(y,e,g),r(y,t,g),r(y,l,g),r(y,c,g),r(y,f,g),r(y,u,g),r(y,_,g),r(y,b,g),r(y,q,g)},p:fe,d(y){y&&(o(e),o(t),o(l),o(c),o(f),o(u),o(_),o(b),o(q))}}}function Ut(a){let e,t;return{c(){e=s("code"),e.textContent='{"lon":x,"lat":y}',t=m(" object.")},m(l,c){r(l,e,c),r(l,t,c)},p:fe,d(l){l&&(o(e),o(t))}}}function It(a){let e;return{c(){e=m("URL address.")},m(t,l){r(t,e,l)},p:fe,d(t){t&&o(e)}}}function xt(a){let e;return{c(){e=m("Email address.")},m(t,l){r(t,e,l)},p:fe,d(t){t&&o(e)}}}function zt(a){let e;return{c(){e=m("JSON array or object.")},m(t,l){r(t,e,l)},p:fe,d(t){t&&o(e)}}}function Kt(a){let e;return{c(){e=m("Number value.")},m(t,l){r(t,e,l)},p:fe,d(t){t&&o(e)}}}function Qt(a){let e,t,l=a[15].autogeneratePattern&&ht();return{c(){e=m(`Plain text value.
                        `),l&&l.c(),t=Ht()},m(c,f){r(c,e,f),l&&l.m(c,f),r(c,t,f)},p(c,f){c[15].autogeneratePattern?l||(l=ht(),l.c(),l.m(t.parentNode,t)):l&&(l.d(1),l=null)},d(c){c&&(o(e),o(t)),l&&l.d(c)}}}function ht(a){let e;return{c(){e=m("It is autogenerated if not set.")},m(t,l){r(t,e,l)},d(t){t&&o(e)}}}function vt(a,e){let t,l,c,f,u,_=e[15].name+"",b,q,y,g,B=we.getFieldValueType(e[15])+"",S,$,R,M;function U(k,F){return!k[15].required||k[15].type=="text"&&k[15].autogeneratePattern?Jt:jt}let D=U(e),P=D(e);function z(k,F){if(k[15].type==="text")return Qt;if(k[15].type==="number")return Kt;if(k[15].type==="json")return zt;if(k[15].type==="email")return xt;if(k[15].type==="url")return It;if(k[15].type==="geoPoint")return Ut;if(k[15].type==="file")return Et;if(k[15].type==="relation")return Dt}let L=z(e),T=L&&L(e);return{key:a,first:null,c(){t=s("tr"),l=s("td"),c=s("div"),P.c(),f=p(),u=s("span"),b=m(_),q=p(),y=s("td"),g=s("span"),S=m(B),$=p(),R=s("td"),T&&T.c(),M=p(),w(c,"class","inline-flex"),w(g,"class","label"),this.first=t},m(k,F){r(k,t,F),i(t,l),i(l,c),P.m(c,null),i(c,f),i(c,u),i(u,b),i(t,q),i(t,y),i(y,g),i(g,S),i(t,$),i(t,R),T&&T.m(R,null),i(t,M)},p(k,F){e=k,D!==(D=U(e))&&(P.d(1),P=D(e),P&&(P.c(),P.m(c,f))),F&32&&_!==(_=e[15].name+"")&&se(b,_),F&32&&B!==(B=we.getFieldValueType(e[15])+"")&&se(S,B),L===(L=z(e))&&T?T.p(e,F):(T&&T.d(1),T=L&&L(e),T&&(T.c(),T.m(R,null)))},d(k){k&&o(t),P.d(),T&&T.d()}}}function wt(a,e){let t,l=e[10].code+"",c,f,u,_;function b(){return e[9](e[10])}return{key:a,first:null,c(){t=s("button"),c=m(l),f=p(),w(t,"class","tab-item"),Se(t,"active",e[2]===e[10].code),this.first=t},m(q,y){r(q,t,y),i(t,c),i(t,f),u||(_=Ot(t,"click",b),u=!0)},p(q,y){e=q,y&8&&l!==(l=e[10].code+"")&&se(c,l),y&12&&Se(t,"active",e[2]===e[10].code)},d(q){q&&o(t),u=!1,_()}}}function gt(a,e){let t,l,c,f;return l=new Ct({props:{content:e[10].body}}),{key:a,first:null,c(){t=s("div"),Te(l.$$.fragment),c=p(),w(t,"class","tab-item"),Se(t,"active",e[2]===e[10].code),this.first=t},m(u,_){r(u,t,_),qe(l,t,null),i(t,c),f=!0},p(u,_){e=u;const b={};_&8&&(b.content=e[10].body),l.$set(b),(!f||_&12)&&Se(t,"active",e[2]===e[10].code)},i(u){f||(ve(l.$$.fragment,u),f=!0)},o(u){he(l.$$.fragment,u),f=!1},d(u){u&&o(t),$e(l)}}}function Gt(a){var at,st,ot,rt;let e,t,l=a[0].name+"",c,f,u,_,b,q,y,g=a[0].name+"",B,S,$,R,M,U,D,P,z,L,T,k,F,ee,Q,I,oe,G,W=a[0].name+"",Y,ue,te,E,Z,X,O,h,C,V,K,H=[],je=new Map,Pe,pe,Me,le,Le,Je,be,ne,Fe,De,Oe,Ee,A,Ue,re,Ie,xe,ze,He,Ke,Re,Qe,Ge,We,Ae,Ye,Ze,de,Be,me,Ne,ie,_e,x=[],Xe=new Map,et,ke,j=[],tt=new Map,ae;P=new St({props:{js:`
import PocketBase from 'pocketbase';

const pb = new PocketBase('${a[4]}');

...

// example create data
const data = ${JSON.stringify(a[7](a[0]),null,4)};

const record = await pb.collection('${(at=a[0])==null?void 0:at.name}').create(data);
`+(a[1]?`
// (optional) send an email verification request
await pb.collection('${(st=a[0])==null?void 0:st.name}').requestVerification('test@example.com');
`:""),dart:`
import 'package:pocketbase/pocketbase.dart';

final pb = PocketBase('${a[4]}');

...

// example create body
final body = <String, dynamic>${JSON.stringify(a[7](a[0]),null,2)};

final record = await pb.collection('${(ot=a[0])==null?void 0:ot.name}').create(body: body);
`+(a[1]?`
// (optional) send an email verification request
await pb.collection('${(rt=a[0])==null?void 0:rt.name}').requestVerification('test@example.com');
`:"")}});let J=a[6]&&kt(),N=a[1]&&yt(a),ge=ce(a[5]);const lt=n=>n[15].name;for(let n=0;n<ge.length;n+=1){let d=_t(a,ge,n),v=lt(d);je.set(v,H[n]=vt(v,d))}re=new Ct({props:{content:"?expand=relField1,relField2.subRelField"}}),de=new Rt({});let Ce=ce(a[3]);const nt=n=>n[10].code;for(let n=0;n<Ce.length;n+=1){let d=mt(a,Ce,n),v=nt(d);Xe.set(v,x[n]=wt(v,d))}let ye=ce(a[3]);const it=n=>n[10].code;for(let n=0;n<ye.length;n+=1){let d=bt(a,ye,n),v=it(d);tt.set(v,j[n]=gt(v,d))}return{c(){e=s("h3"),t=m("Create ("),c=m(l),f=m(")"),u=p(),_=s("div"),b=s("p"),q=m("Create a new "),y=s("strong"),B=m(g),S=m(" record."),$=p(),R=s("p"),R.innerHTML=`Body parameters could be sent as <code>application/json</code> or
        <code>multipart/form-data</code>.`,M=p(),U=s("p"),U.innerHTML=`File upload is supported only via <code>multipart/form-data</code>.
        <br/>
        For more info and examples you could check the detailed
        <a href="https://pocketbase.io/docs/files-handling" target="_blank" rel="noopener noreferrer">Files upload and handling docs
        </a>.`,D=p(),Te(P.$$.fragment),z=p(),L=s("h6"),L.textContent="API details",T=p(),k=s("div"),F=s("strong"),F.textContent="POST",ee=p(),Q=s("div"),I=s("p"),oe=m("/api/collections/"),G=s("strong"),Y=m(W),ue=m("/records"),te=p(),J&&J.c(),E=p(),Z=s("div"),Z.textContent="Body Parameters",X=p(),O=s("table"),h=s("thead"),h.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr>',C=p(),V=s("tbody"),N&&N.c(),K=p();for(let n=0;n<H.length;n+=1)H[n].c();Pe=p(),pe=s("div"),pe.textContent="Query parameters",Me=p(),le=s("table"),Le=s("thead"),Le.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr>',Je=p(),be=s("tbody"),ne=s("tr"),Fe=s("td"),Fe.textContent="expand",De=p(),Oe=s("td"),Oe.innerHTML='<span class="label">String</span>',Ee=p(),A=s("td"),Ue=m(`Auto expand relations when returning the created record. Ex.:
                `),Te(re.$$.fragment),Ie=m(`
                Supports up to 6-levels depth nested relations expansion. `),xe=s("br"),ze=m(`
                The expanded relations will be appended to the record under the
                `),He=s("code"),He.textContent="expand",Ke=m(" property (eg. "),Re=s("code"),Re.textContent='"expand": {"relField1": {...}, ...}',Qe=m(`).
                `),Ge=s("br"),We=m(`
                Only the relations to which the request user has permissions to `),Ae=s("strong"),Ae.textContent="view",Ye=m(" will be expanded."),Ze=p(),Te(de.$$.fragment),Be=p(),me=s("div"),me.textContent="Responses",Ne=p(),ie=s("div"),_e=s("div");for(let n=0;n<x.length;n+=1)x[n].c();et=p(),ke=s("div");for(let n=0;n<j.length;n+=1)j[n].c();w(e,"class","m-b-sm"),w(_,"class","content txt-lg m-b-sm"),w(L,"class","m-b-xs"),w(F,"class","label label-primary"),w(Q,"class","content"),w(k,"class","alert alert-success"),w(Z,"class","section-title"),w(O,"class","table-compact table-border m-b-base"),w(pe,"class","section-title"),w(le,"class","table-compact table-border m-b-base"),w(me,"class","section-title"),w(_e,"class","tabs-header compact combined left"),w(ke,"class","tabs-content"),w(ie,"class","tabs")},m(n,d){r(n,e,d),i(e,t),i(e,c),i(e,f),r(n,u,d),r(n,_,d),i(_,b),i(b,q),i(b,y),i(y,B),i(b,S),i(_,$),i(_,R),i(_,M),i(_,U),r(n,D,d),qe(P,n,d),r(n,z,d),r(n,L,d),r(n,T,d),r(n,k,d),i(k,F),i(k,ee),i(k,Q),i(Q,I),i(I,oe),i(I,G),i(G,Y),i(I,ue),i(k,te),J&&J.m(k,null),r(n,E,d),r(n,Z,d),r(n,X,d),r(n,O,d),i(O,h),i(O,C),i(O,V),N&&N.m(V,null),i(V,K);for(let v=0;v<H.length;v+=1)H[v]&&H[v].m(V,null);r(n,Pe,d),r(n,pe,d),r(n,Me,d),r(n,le,d),i(le,Le),i(le,Je),i(le,be),i(be,ne),i(ne,Fe),i(ne,De),i(ne,Oe),i(ne,Ee),i(ne,A),i(A,Ue),qe(re,A,null),i(A,Ie),i(A,xe),i(A,ze),i(A,He),i(A,Ke),i(A,Re),i(A,Qe),i(A,Ge),i(A,We),i(A,Ae),i(A,Ye),i(be,Ze),qe(de,be,null),r(n,Be,d),r(n,me,d),r(n,Ne,d),r(n,ie,d),i(ie,_e);for(let v=0;v<x.length;v+=1)x[v]&&x[v].m(_e,null);i(ie,et),i(ie,ke);for(let v=0;v<j.length;v+=1)j[v]&&j[v].m(ke,null);ae=!0},p(n,[d]){var dt,ct,ft,ut;(!ae||d&1)&&l!==(l=n[0].name+"")&&se(c,l),(!ae||d&1)&&g!==(g=n[0].name+"")&&se(B,g);const v={};d&19&&(v.js=`
import PocketBase from 'pocketbase';

const pb = new PocketBase('${n[4]}');

...

// example create data
const data = ${JSON.stringify(n[7](n[0]),null,4)};

const record = await pb.collection('${(dt=n[0])==null?void 0:dt.name}').create(data);
`+(n[1]?`
// (optional) send an email verification request
await pb.collection('${(ct=n[0])==null?void 0:ct.name}').requestVerification('test@example.com');
`:"")),d&19&&(v.dart=`
import 'package:pocketbase/pocketbase.dart';

final pb = PocketBase('${n[4]}');

...

// example create body
final body = <String, dynamic>${JSON.stringify(n[7](n[0]),null,2)};

final record = await pb.collection('${(ft=n[0])==null?void 0:ft.name}').create(body: body);
`+(n[1]?`
// (optional) send an email verification request
await pb.collection('${(ut=n[0])==null?void 0:ut.name}').requestVerification('test@example.com');
`:"")),P.$set(v),(!ae||d&1)&&W!==(W=n[0].name+"")&&se(Y,W),n[6]?J||(J=kt(),J.c(),J.m(k,null)):J&&(J.d(1),J=null),n[1]?N?N.p(n,d):(N=yt(n),N.c(),N.m(V,K)):N&&(N.d(1),N=null),d&32&&(ge=ce(n[5]),H=Ve(H,d,lt,1,n,ge,je,V,pt,vt,null,_t)),d&12&&(Ce=ce(n[3]),x=Ve(x,d,nt,1,n,Ce,Xe,_e,pt,wt,null,mt)),d&12&&(ye=ce(n[3]),Pt(),j=Ve(j,d,it,1,n,ye,tt,ke,Mt,gt,null,bt),Lt())},i(n){if(!ae){ve(P.$$.fragment,n),ve(re.$$.fragment,n),ve(de.$$.fragment,n);for(let d=0;d<ye.length;d+=1)ve(j[d]);ae=!0}},o(n){he(P.$$.fragment,n),he(re.$$.fragment,n),he(de.$$.fragment,n);for(let d=0;d<j.length;d+=1)he(j[d]);ae=!1},d(n){n&&(o(e),o(u),o(_),o(D),o(z),o(L),o(T),o(k),o(E),o(Z),o(X),o(O),o(Pe),o(pe),o(Me),o(le),o(Be),o(me),o(Ne),o(ie)),$e(P,n),J&&J.d(),N&&N.d();for(let d=0;d<H.length;d+=1)H[d].d();$e(re),$e(de);for(let d=0;d<x.length;d+=1)x[d].d();for(let d=0;d<j.length;d+=1)j[d].d()}}}const Wt=a=>a.name=="emailVisibility",Yt=a=>a.name=="email";function Zt(a,e,t){let l,c,f,u,_,{collection:b}=e,q=200,y=[];function g(S){let $=we.dummyCollectionSchemaData(S,!0);return l&&($.password="12345678",$.passwordConfirm="12345678",delete $.verified),$}const B=S=>t(2,q=S.code);return a.$$set=S=>{"collection"in S&&t(0,b=S.collection)},a.$$.update=()=>{var S,$,R;a.$$.dirty&1&&t(1,l=b.type==="auth"),a.$$.dirty&1&&t(6,c=(b==null?void 0:b.createRule)===null),a.$$.dirty&2&&t(8,f=l?["password","verified","email","emailVisibility"]:[]),a.$$.dirty&257&&t(5,u=((S=b==null?void 0:b.fields)==null?void 0:S.filter(M=>!M.hidden&&M.type!="autodate"&&!f.includes(M.name)))||[]),a.$$.dirty&1&&t(3,y=[{code:200,body:JSON.stringify(we.dummyCollectionRecord(b),null,2)},{code:400,body:`
                {
                  "status": 400,
                  "message": "Failed to create record.",
                  "data": {
                    "${(R=($=b==null?void 0:b.fields)==null?void 0:$[0])==null?void 0:R.name}": {
                      "code": "validation_required",
                      "message": "Missing required value."
                    }
                  }
                }
            `},{code:403,body:`
                {
                  "status": 403,
                  "message": "You are not allowed to perform this request.",
                  "data": {}
                }
            `}])},t(4,_=we.getApiExampleUrl(Ft.baseURL)),[b,l,q,y,_,u,c,g,f,B]}class tl extends $t{constructor(e){super(),qt(this,e,Zt,Gt,Tt,{collection:0})}}export{tl as default};
