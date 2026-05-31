import{d as $t,E as Mt,U as St,S as Ot,z as se,a as Ct,w as d,u as ge,a3 as _e,a2 as he,V as ee,a4 as Ie,t as bt,D as qt,N as Pt,l as Rt,G as o,i as a,K as we,x as s,_,Z as f,s as Te,j as k,b as ye,P as Lt,a0 as Ce,J as Ht,L as te}from"./index-B4OIv7rD.js";import{F as Dt}from"./FieldsQueryParam-DoNDyVnE.js";function mt(r,e,t){const n=r.slice();return n[10]=e[t],n}function _t(r,e,t){const n=r.slice();return n[10]=e[t],n}function ht(r,e,t){const n=r.slice();return n[15]=e[t],n}function yt(r){let e;return{c(){e=s("p"),e.innerHTML=`<em>Note that in case of a password change all previously issued tokens for the current record
                will be automatically invalidated and if you want your user to remain signed in you need to
                reauthenticate manually after the update call.</em>`},m(t,n){o(t,e,n)},d(t){t&&d(e)}}}function kt(r){let e;return{c(){e=s("p"),e.innerHTML="Requires superuser <code>Authorization:TOKEN</code> header",k(e,"class","txt-hint txt-sm txt-right")},m(t,n){o(t,e,n)},d(t){t&&d(e)}}}function vt(r){let e,t,n,b,p,c,u,m,S,C,R,L,$,M,q,H,I,U,O,P,D,v,g,w;function x(h,T){var le,K,ne;return T&1&&(m=null),m==null&&(m=!!((ne=(K=(le=h[0])==null?void 0:le.fields)==null?void 0:K.find(Qt))!=null&&ne.required)),m?Nt:Ft}let z=x(r,-1),N=z(r);return{c(){e=s("tr"),e.innerHTML='<td colspan="3" class="txt-hint txt-bold">Auth specific fields</td>',t=f(),n=s("tr"),n.innerHTML=`<td><div class="inline-flex"><span class="label label-warning">Optional</span> <span>email</span></div></td> <td><span class="label">String</span></td> <td>The auth record email address.
                    <br/>
                    This field can be updated only by superusers or auth records with &quot;Manage&quot; access.
                    <br/>
                    Regular accounts can update their email by calling &quot;Request email change&quot;.</td>`,b=f(),p=s("tr"),c=s("td"),u=s("div"),N.c(),S=f(),C=s("span"),C.textContent="emailVisibility",R=f(),L=s("td"),L.innerHTML='<span class="label">Boolean</span>',$=f(),M=s("td"),M.textContent="Whether to show/hide the auth record email when fetching the record data.",q=f(),H=s("tr"),H.innerHTML=`<td><div class="inline-flex"><span class="label label-warning">Optional</span> <span>oldPassword</span></div></td> <td><span class="label">String</span></td> <td>Old auth record password.
                    <br/>
                    This field is required only when changing the record password. Superusers and auth records
                    with &quot;Manage&quot; access can skip this field.</td>`,I=f(),U=s("tr"),U.innerHTML='<td><div class="inline-flex"><span class="label label-warning">Optional</span> <span>password</span></div></td> <td><span class="label">String</span></td> <td>New auth record password.</td>',O=f(),P=s("tr"),P.innerHTML='<td><div class="inline-flex"><span class="label label-warning">Optional</span> <span>passwordConfirm</span></div></td> <td><span class="label">String</span></td> <td>New auth record password confirmation.</td>',D=f(),v=s("tr"),v.innerHTML=`<td><div class="inline-flex"><span class="label label-warning">Optional</span> <span>verified</span></div></td> <td><span class="label">Boolean</span></td> <td>Indicates whether the auth record is verified or not.
                    <br/>
                    This field can be set only by superusers or auth records with &quot;Manage&quot; access.</td>`,g=f(),w=s("tr"),w.innerHTML='<td colspan="3" class="txt-hint txt-bold">Other fields</td>',k(u,"class","inline-flex")},m(h,T){o(h,e,T),o(h,t,T),o(h,n,T),o(h,b,T),o(h,p,T),a(p,c),a(c,u),N.m(u,null),a(u,S),a(u,C),a(p,R),a(p,L),a(p,$),a(p,M),o(h,q,T),o(h,H,T),o(h,I,T),o(h,U,T),o(h,O,T),o(h,P,T),o(h,D,T),o(h,v,T),o(h,g,T),o(h,w,T)},p(h,T){z!==(z=x(h,T))&&(N.d(1),N=z(h),N&&(N.c(),N.m(u,S)))},d(h){h&&(d(e),d(t),d(n),d(b),d(p),d(q),d(H),d(I),d(U),d(O),d(P),d(D),d(v),d(g),d(w)),N.d()}}}function Ft(r){let e;return{c(){e=s("span"),e.textContent="Optional",k(e,"class","label label-warning")},m(t,n){o(t,e,n)},d(t){t&&d(e)}}}function Nt(r){let e;return{c(){e=s("span"),e.textContent="Required",k(e,"class","label label-success")},m(t,n){o(t,e,n)},d(t){t&&d(e)}}}function Bt(r){let e;return{c(){e=s("span"),e.textContent="Optional",k(e,"class","label label-warning")},m(t,n){o(t,e,n)},d(t){t&&d(e)}}}function At(r){let e;return{c(){e=s("span"),e.textContent="Required",k(e,"class","label label-success")},m(t,n){o(t,e,n)},d(t){t&&d(e)}}}function Et(r){let e,t=r[15].maxSelect==1?"id":"ids",n,b;return{c(){e=_("Relation record "),n=_(t),b=_(".")},m(p,c){o(p,e,c),o(p,n,c),o(p,b,c)},p(p,c){c&32&&t!==(t=p[15].maxSelect==1?"id":"ids")&&ee(n,t)},d(p){p&&(d(e),d(n),d(b))}}}function jt(r){let e,t,n,b,p;return{c(){e=_("File object."),t=s("br"),n=_(`
                        Set to `),b=s("code"),b.textContent="null",p=_(" to delete already uploaded file(s).")},m(c,u){o(c,e,u),o(c,t,u),o(c,n,u),o(c,b,u),o(c,p,u)},p:te,d(c){c&&(d(e),d(t),d(n),d(b),d(p))}}}function Ut(r){let e,t;return{c(){e=s("code"),e.textContent='{"lon":x,"lat":y}',t=_(" object.")},m(n,b){o(n,e,b),o(n,t,b)},p:te,d(n){n&&(d(e),d(t))}}}function It(r){let e;return{c(){e=_("URL address.")},m(t,n){o(t,e,n)},p:te,d(t){t&&d(e)}}}function Jt(r){let e;return{c(){e=_("Email address.")},m(t,n){o(t,e,n)},p:te,d(t){t&&d(e)}}}function Vt(r){let e;return{c(){e=_("JSON array or object.")},m(t,n){o(t,e,n)},p:te,d(t){t&&d(e)}}}function xt(r){let e;return{c(){e=_("Number value.")},m(t,n){o(t,e,n)},p:te,d(t){t&&d(e)}}}function zt(r){let e;return{c(){e=_("Plain text value.")},m(t,n){o(t,e,n)},p:te,d(t){t&&d(e)}}}function gt(r,e){let t,n,b,p,c,u=e[15].name+"",m,S,C,R,L=ye.getFieldValueType(e[15])+"",$,M,q,H;function I(g,w){return g[15].required?At:Bt}let U=I(e),O=U(e);function P(g,w){if(g[15].type==="text")return zt;if(g[15].type==="number")return xt;if(g[15].type==="json")return Vt;if(g[15].type==="email")return Jt;if(g[15].type==="url")return It;if(g[15].type==="geoPoint")return Ut;if(g[15].type==="file")return jt;if(g[15].type==="relation")return Et}let D=P(e),v=D&&D(e);return{key:r,first:null,c(){t=s("tr"),n=s("td"),b=s("div"),O.c(),p=f(),c=s("span"),m=_(u),S=f(),C=s("td"),R=s("span"),$=_(L),M=f(),q=s("td"),v&&v.c(),H=f(),k(b,"class","inline-flex"),k(R,"class","label"),this.first=t},m(g,w){o(g,t,w),a(t,n),a(n,b),O.m(b,null),a(b,p),a(b,c),a(c,m),a(t,S),a(t,C),a(C,R),a(R,$),a(t,M),a(t,q),v&&v.m(q,null),a(t,H)},p(g,w){e=g,U!==(U=I(e))&&(O.d(1),O=U(e),O&&(O.c(),O.m(b,p))),w&32&&u!==(u=e[15].name+"")&&ee(m,u),w&32&&L!==(L=ye.getFieldValueType(e[15])+"")&&ee($,L),D===(D=P(e))&&v?v.p(e,w):(v&&v.d(1),v=D&&D(e),v&&(v.c(),v.m(q,null)))},d(g){g&&d(t),O.d(),v&&v.d()}}}function wt(r,e){let t,n=e[10].code+"",b,p,c,u;function m(){return e[9](e[10])}return{key:r,first:null,c(){t=s("button"),b=_(n),p=f(),k(t,"class","tab-item"),Ce(t,"active",e[2]===e[10].code),this.first=t},m(S,C){o(S,t,C),a(t,b),a(t,p),c||(u=Ht(t,"click",m),c=!0)},p(S,C){e=S,C&8&&n!==(n=e[10].code+"")&&ee(b,n),C&12&&Ce(t,"active",e[2]===e[10].code)},d(S){S&&d(t),c=!1,u()}}}function Tt(r,e){let t,n,b,p;return n=new Ct({props:{content:e[10].body}}),{key:r,first:null,c(){t=s("div"),Te(n.$$.fragment),b=f(),k(t,"class","tab-item"),Ce(t,"active",e[2]===e[10].code),this.first=t},m(c,u){o(c,t,u),we(n,t,null),a(t,b),p=!0},p(c,u){e=c;const m={};u&8&&(m.content=e[10].body),n.$set(m),(!p||u&12)&&Ce(t,"active",e[2]===e[10].code)},i(c){p||(he(n.$$.fragment,c),p=!0)},o(c){_e(n.$$.fragment,c),p=!1},d(c){c&&d(t),ge(n)}}}function Kt(r){var ct,ut;let e,t,n=r[0].name+"",b,p,c,u,m,S,C,R=r[0].name+"",L,$,M,q,H,I,U,O,P,D,v,g,w,x,z,N,h,T,le,K=r[0].name+"",ne,Je,$e,Ve,Me,de,Se,oe,Oe,re,qe,Q,Pe,xe,G,Re,J=[],ze=new Map,Le,ce,He,W,De,Ke,ue,Y,Fe,Qe,Ne,Ge,B,We,ae,Ye,Ze,Xe,Be,et,Ae,tt,Ee,lt,nt,ie,je,pe,Ue,Z,fe,V=[],at=new Map,it,be,A=[],st=new Map,X,E=r[1]&&yt();P=new Ot({props:{js:`
import PocketBase from 'pocketbase';

const pb = new PocketBase('${r[4]}');

...

// example update data
const data = ${JSON.stringify(r[7](r[0]),null,4)};

const record = await pb.collection('${(ct=r[0])==null?void 0:ct.name}').update('RECORD_ID', data);
    `,dart:`
import 'package:pocketbase/pocketbase.dart';

final pb = PocketBase('${r[4]}');

...

// example update body
final body = <String, dynamic>${JSON.stringify(r[7](r[0]),null,2)};

final record = await pb.collection('${(ut=r[0])==null?void 0:ut.name}').update('RECORD_ID', body: body);
    `}});let j=r[6]&&kt(),F=r[1]&&vt(r),ke=se(r[5]);const dt=l=>l[15].name;for(let l=0;l<ke.length;l+=1){let i=ht(r,ke,l),y=dt(i);ze.set(y,J[l]=gt(y,i))}ae=new Ct({props:{content:"?expand=relField1,relField2.subRelField21"}}),ie=new Dt({});let ve=se(r[3]);const ot=l=>l[10].code;for(let l=0;l<ve.length;l+=1){let i=_t(r,ve,l),y=ot(i);at.set(y,V[l]=wt(y,i))}let me=se(r[3]);const rt=l=>l[10].code;for(let l=0;l<me.length;l+=1){let i=mt(r,me,l),y=rt(i);st.set(y,A[l]=Tt(y,i))}return{c(){e=s("h3"),t=_("Update ("),b=_(n),p=_(")"),c=f(),u=s("div"),m=s("p"),S=_("Update a single "),C=s("strong"),L=_(R),$=_(" record."),M=f(),q=s("p"),q.innerHTML=`Body parameters could be sent as <code>application/json</code> or
        <code>multipart/form-data</code>.`,H=f(),I=s("p"),I.innerHTML=`File upload is supported only via <code>multipart/form-data</code>.
        <br/>
        For more info and examples you could check the detailed
        <a href="https://pocketbase.io/docs/files-handling" target="_blank" rel="noopener noreferrer">Files upload and handling docs
        </a>.`,U=f(),E&&E.c(),O=f(),Te(P.$$.fragment),D=f(),v=s("h6"),v.textContent="API details",g=f(),w=s("div"),x=s("strong"),x.textContent="PATCH",z=f(),N=s("div"),h=s("p"),T=_("/api/collections/"),le=s("strong"),ne=_(K),Je=_("/records/"),$e=s("strong"),$e.textContent=":id",Ve=f(),j&&j.c(),Me=f(),de=s("div"),de.textContent="Path parameters",Se=f(),oe=s("table"),oe.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr></thead> <tbody><tr><td>id</td> <td><span class="label">String</span></td> <td>ID of the record to update.</td></tr></tbody>',Oe=f(),re=s("div"),re.textContent="Body Parameters",qe=f(),Q=s("table"),Pe=s("thead"),Pe.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr>',xe=f(),G=s("tbody"),F&&F.c(),Re=f();for(let l=0;l<J.length;l+=1)J[l].c();Le=f(),ce=s("div"),ce.textContent="Query parameters",He=f(),W=s("table"),De=s("thead"),De.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr>',Ke=f(),ue=s("tbody"),Y=s("tr"),Fe=s("td"),Fe.textContent="expand",Qe=f(),Ne=s("td"),Ne.innerHTML='<span class="label">String</span>',Ge=f(),B=s("td"),We=_(`Auto expand relations when returning the updated record. Ex.:
                `),Te(ae.$$.fragment),Ye=_(`
                Supports up to 6-levels depth nested relations expansion. `),Ze=s("br"),Xe=_(`
                The expanded relations will be appended to the record under the
                `),Be=s("code"),Be.textContent="expand",et=_(" property (eg. "),Ae=s("code"),Ae.textContent='"expand": {"relField1": {...}, ...}',tt=_(`). Only
                the relations that the user has permissions to `),Ee=s("strong"),Ee.textContent="view",lt=_(" will be expanded."),nt=f(),Te(ie.$$.fragment),je=f(),pe=s("div"),pe.textContent="Responses",Ue=f(),Z=s("div"),fe=s("div");for(let l=0;l<V.length;l+=1)V[l].c();it=f(),be=s("div");for(let l=0;l<A.length;l+=1)A[l].c();k(e,"class","m-b-sm"),k(u,"class","content txt-lg m-b-sm"),k(v,"class","m-b-xs"),k(x,"class","label label-primary"),k(N,"class","content"),k(w,"class","alert alert-warning"),k(de,"class","section-title"),k(oe,"class","table-compact table-border m-b-base"),k(re,"class","section-title"),k(Q,"class","table-compact table-border m-b-base"),k(ce,"class","section-title"),k(W,"class","table-compact table-border m-b-lg"),k(pe,"class","section-title"),k(fe,"class","tabs-header compact combined left"),k(be,"class","tabs-content"),k(Z,"class","tabs")},m(l,i){o(l,e,i),a(e,t),a(e,b),a(e,p),o(l,c,i),o(l,u,i),a(u,m),a(m,S),a(m,C),a(C,L),a(m,$),a(u,M),a(u,q),a(u,H),a(u,I),a(u,U),E&&E.m(u,null),o(l,O,i),we(P,l,i),o(l,D,i),o(l,v,i),o(l,g,i),o(l,w,i),a(w,x),a(w,z),a(w,N),a(N,h),a(h,T),a(h,le),a(le,ne),a(h,Je),a(h,$e),a(w,Ve),j&&j.m(w,null),o(l,Me,i),o(l,de,i),o(l,Se,i),o(l,oe,i),o(l,Oe,i),o(l,re,i),o(l,qe,i),o(l,Q,i),a(Q,Pe),a(Q,xe),a(Q,G),F&&F.m(G,null),a(G,Re);for(let y=0;y<J.length;y+=1)J[y]&&J[y].m(G,null);o(l,Le,i),o(l,ce,i),o(l,He,i),o(l,W,i),a(W,De),a(W,Ke),a(W,ue),a(ue,Y),a(Y,Fe),a(Y,Qe),a(Y,Ne),a(Y,Ge),a(Y,B),a(B,We),we(ae,B,null),a(B,Ye),a(B,Ze),a(B,Xe),a(B,Be),a(B,et),a(B,Ae),a(B,tt),a(B,Ee),a(B,lt),a(ue,nt),we(ie,ue,null),o(l,je,i),o(l,pe,i),o(l,Ue,i),o(l,Z,i),a(Z,fe);for(let y=0;y<V.length;y+=1)V[y]&&V[y].m(fe,null);a(Z,it),a(Z,be);for(let y=0;y<A.length;y+=1)A[y]&&A[y].m(be,null);X=!0},p(l,[i]){var pt,ft;(!X||i&1)&&n!==(n=l[0].name+"")&&ee(b,n),(!X||i&1)&&R!==(R=l[0].name+"")&&ee(L,R),l[1]?E||(E=yt(),E.c(),E.m(u,null)):E&&(E.d(1),E=null);const y={};i&17&&(y.js=`
import PocketBase from 'pocketbase';

const pb = new PocketBase('${l[4]}');

...

// example update data
const data = ${JSON.stringify(l[7](l[0]),null,4)};

const record = await pb.collection('${(pt=l[0])==null?void 0:pt.name}').update('RECORD_ID', data);
    `),i&17&&(y.dart=`
import 'package:pocketbase/pocketbase.dart';

final pb = PocketBase('${l[4]}');

...

// example update body
final body = <String, dynamic>${JSON.stringify(l[7](l[0]),null,2)};

final record = await pb.collection('${(ft=l[0])==null?void 0:ft.name}').update('RECORD_ID', body: body);
    `),P.$set(y),(!X||i&1)&&K!==(K=l[0].name+"")&&ee(ne,K),l[6]?j||(j=kt(),j.c(),j.m(w,null)):j&&(j.d(1),j=null),l[1]?F?F.p(l,i):(F=vt(l),F.c(),F.m(G,Re)):F&&(F.d(1),F=null),i&32&&(ke=se(l[5]),J=Ie(J,i,dt,1,l,ke,ze,G,bt,gt,null,ht)),i&12&&(ve=se(l[3]),V=Ie(V,i,ot,1,l,ve,at,fe,bt,wt,null,_t)),i&12&&(me=se(l[3]),qt(),A=Ie(A,i,rt,1,l,me,st,be,Pt,Tt,null,mt),Rt())},i(l){if(!X){he(P.$$.fragment,l),he(ae.$$.fragment,l),he(ie.$$.fragment,l);for(let i=0;i<me.length;i+=1)he(A[i]);X=!0}},o(l){_e(P.$$.fragment,l),_e(ae.$$.fragment,l),_e(ie.$$.fragment,l);for(let i=0;i<A.length;i+=1)_e(A[i]);X=!1},d(l){l&&(d(e),d(c),d(u),d(O),d(D),d(v),d(g),d(w),d(Me),d(de),d(Se),d(oe),d(Oe),d(re),d(qe),d(Q),d(Le),d(ce),d(He),d(W),d(je),d(pe),d(Ue),d(Z)),E&&E.d(),ge(P,l),j&&j.d(),F&&F.d();for(let i=0;i<J.length;i+=1)J[i].d();ge(ae),ge(ie);for(let i=0;i<V.length;i+=1)V[i].d();for(let i=0;i<A.length;i+=1)A[i].d()}}}const Qt=r=>r.name=="emailVisibility";function Gt(r,e,t){let n,b,p,c,u,{collection:m}=e,S=200,C=[];function R($){let M=ye.dummyCollectionSchemaData($,!0);return n&&(M.oldPassword="12345678",M.password="87654321",M.passwordConfirm="87654321",delete M.verified,delete M.email),M}const L=$=>t(2,S=$.code);return r.$$set=$=>{"collection"in $&&t(0,m=$.collection)},r.$$.update=()=>{var $,M,q;r.$$.dirty&1&&t(1,n=(m==null?void 0:m.type)==="auth"),r.$$.dirty&1&&t(6,b=(m==null?void 0:m.updateRule)===null),r.$$.dirty&2&&t(8,p=n?["id","password","verified","email","emailVisibility"]:["id"]),r.$$.dirty&257&&t(5,c=(($=m==null?void 0:m.fields)==null?void 0:$.filter(H=>!H.hidden&&H.type!="autodate"&&!p.includes(H.name)))||[]),r.$$.dirty&1&&t(3,C=[{code:200,body:JSON.stringify(ye.dummyCollectionRecord(m),null,2)},{code:400,body:`
                {
                  "status": 400,
                  "message": "Failed to update record.",
                  "data": {
                    "${(q=(M=m==null?void 0:m.fields)==null?void 0:M[0])==null?void 0:q.name}": {
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
            `},{code:404,body:`
                {
                  "status": 404,
                  "message": "The requested resource wasn't found.",
                  "data": {}
                }
            `}])},t(4,u=ye.getApiExampleUrl(Lt.baseURL)),[m,n,S,C,u,c,b,R,p,L]}class Zt extends $t{constructor(e){super(),Mt(this,e,Gt,Kt,St,{collection:0})}}export{Zt as default};
