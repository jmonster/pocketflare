import{d as kt,E as gt,U as vt,S as St,z as L,a as _t,w as c,u as ae,v as wt,a3 as z,a2 as G,V as Z,a4 as ct,t as yt,D as $t,N as Pt,l as Rt,G as d,i as t,K as oe,x as s,_ as f,Z as u,s as se,j as k,b as dt,P as Ct,a0 as ne,J as Ot}from"./index-Ckgw6Jlu.js";import{F as Tt}from"./FieldsQueryParam-4QAauDet.js";function pt(i,o,a){const n=i.slice();return n[7]=o[a],n}function ut(i,o,a){const n=i.slice();return n[7]=o[a],n}function ht(i,o,a){const n=i.slice();return n[12]=o[a],n[14]=a,n}function At(i){let o;return{c(){o=f("or")},m(a,n){d(a,o,n)},d(a){a&&c(o)}}}function bt(i){let o,a,n=i[12]+"",m,b=i[14]>0&&At();return{c(){b&&b.c(),o=u(),a=s("strong"),m=f(n)},m(r,h){b&&b.m(r,h),d(r,o,h),d(r,a,h),t(a,m)},p(r,h){h&2&&n!==(n=r[12]+"")&&Z(m,n)},d(r){r&&(c(o),c(a)),b&&b.d(r)}}}function ft(i,o){let a,n=o[7].code+"",m,b,r,h;function g(){return o[6](o[7])}return{key:i,first:null,c(){a=s("button"),m=f(n),b=u(),k(a,"class","tab-item"),ne(a,"active",o[2]===o[7].code),this.first=a},m($,_){d($,a,_),t(a,m),t(a,b),r||(h=Ot(a,"click",g),r=!0)},p($,_){o=$,_&8&&n!==(n=o[7].code+"")&&Z(m,n),_&12&&ne(a,"active",o[2]===o[7].code)},d($){$&&c(a),r=!1,h()}}}function mt(i,o){let a,n,m,b;return n=new _t({props:{content:o[7].body}}),{key:i,first:null,c(){a=s("div"),se(n.$$.fragment),m=u(),k(a,"class","tab-item"),ne(a,"active",o[2]===o[7].code),this.first=a},m(r,h){d(r,a,h),oe(n,a,null),t(a,m),b=!0},p(r,h){o=r;const g={};h&8&&(g.content=o[7].body),n.$set(g),(!b||h&12)&&ne(a,"active",o[2]===o[7].code)},i(r){b||(G(n.$$.fragment,r),b=!0)},o(r){z(n.$$.fragment,r),b=!1},d(r){r&&c(a),ae(n)}}}function Dt(i){var ot,st;let o,a,n=i[0].name+"",m,b,r,h,g,$,_,X=i[1].join("/")+"",ie,De,re,Ue,ce,R,de,q,pe,C,x,We,ee,H,Fe,ue,te=i[0].name+"",he,Me,be,j,fe,O,me,Be,E,T,_e,Le,ke,qe,N,ge,He,ve,Se,V,we,A,ye,je,Y,D,$e,Ee,Pe,Ne,v,Ve,F,Ye,Je,Ie,Re,Ke,Ce,Qe,ze,Ge,Oe,Ze,Xe,M,Te,J,Ae,U,I,P=[],xe=new Map,et,K,w=[],tt=new Map,W;R=new St({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${i[5]}');

        ...

        const authData = await pb.collection('${(ot=i[0])==null?void 0:ot.name}').authWithPassword(
            '${i[4]}',
            'YOUR_PASSWORD',
        );

        // after the above you can also access the auth data from the authStore
        console.log(pb.authStore.isValid);
        console.log(pb.authStore.token);
        console.log(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${i[5]}');

        ...

        final authData = await pb.collection('${(st=i[0])==null?void 0:st.name}').authWithPassword(
          '${i[4]}',
          'YOUR_PASSWORD',
        );

        // after the above you can also access the auth data from the authStore
        print(pb.authStore.isValid);
        print(pb.authStore.token);
        print(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `}});let B=L(i[1]),S=[];for(let e=0;e<B.length;e+=1)S[e]=bt(ht(i,B,e));F=new _t({props:{content:"?expand=relField1,relField2.subRelField"}}),M=new Tt({props:{prefix:"record."}});let le=L(i[3]);const lt=e=>e[7].code;for(let e=0;e<le.length;e+=1){let l=ut(i,le,e),p=lt(l);xe.set(p,P[e]=ft(p,l))}let Q=L(i[3]);const at=e=>e[7].code;for(let e=0;e<Q.length;e+=1){let l=pt(i,Q,e),p=at(l);tt.set(p,w[e]=mt(p,l))}return{c(){o=s("h3"),a=f("Auth with password ("),m=f(n),b=f(")"),r=u(),h=s("div"),g=s("p"),$=f(`Authenticate with combination of
        `),_=s("strong"),ie=f(X),De=f(" and "),re=s("strong"),re.textContent="password",Ue=f("."),ce=u(),se(R.$$.fragment),de=u(),q=s("h6"),q.textContent="API details",pe=u(),C=s("div"),x=s("strong"),x.textContent="POST",We=u(),ee=s("div"),H=s("p"),Fe=f("/api/collections/"),ue=s("strong"),he=f(te),Me=f("/auth-with-password"),be=u(),j=s("div"),j.textContent="Body Parameters",fe=u(),O=s("table"),me=s("thead"),me.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr>',Be=u(),E=s("tbody"),T=s("tr"),_e=s("td"),_e.innerHTML='<div class="inline-flex"><span class="label label-success">Required</span> <span>identity</span></div>',Le=u(),ke=s("td"),ke.innerHTML='<span class="label">String</span>',qe=u(),N=s("td");for(let e=0;e<S.length;e+=1)S[e].c();ge=f(`
                of the record to authenticate.`),He=u(),ve=s("tr"),ve.innerHTML='<td><div class="inline-flex"><span class="label label-success">Required</span> <span>password</span></div></td> <td><span class="label">String</span></td> <td>The auth record password.</td>',Se=u(),V=s("div"),V.textContent="Query parameters",we=u(),A=s("table"),ye=s("thead"),ye.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr>',je=u(),Y=s("tbody"),D=s("tr"),$e=s("td"),$e.textContent="expand",Ee=u(),Pe=s("td"),Pe.innerHTML='<span class="label">String</span>',Ne=u(),v=s("td"),Ve=f(`Auto expand record relations. Ex.:
                `),se(F.$$.fragment),Ye=f(`
                Supports up to 6-levels depth nested relations expansion. `),Je=s("br"),Ie=f(`
                The expanded relations will be appended to the record under the
                `),Re=s("code"),Re.textContent="expand",Ke=f(" property (eg. "),Ce=s("code"),Ce.textContent='"expand": {"relField1": {...}, ...}',Qe=f(`).
                `),ze=s("br"),Ge=f(`
                Only the relations to which the request user has permissions to `),Oe=s("strong"),Oe.textContent="view",Ze=f(" will be expanded."),Xe=u(),se(M.$$.fragment),Te=u(),J=s("div"),J.textContent="Responses",Ae=u(),U=s("div"),I=s("div");for(let e=0;e<P.length;e+=1)P[e].c();et=u(),K=s("div");for(let e=0;e<w.length;e+=1)w[e].c();k(o,"class","m-b-sm"),k(h,"class","content txt-lg m-b-sm"),k(q,"class","m-b-xs"),k(x,"class","label label-primary"),k(ee,"class","content"),k(C,"class","alert alert-success"),k(j,"class","section-title"),k(O,"class","table-compact table-border m-b-base"),k(V,"class","section-title"),k(A,"class","table-compact table-border m-b-base"),k(J,"class","section-title"),k(I,"class","tabs-header compact combined left"),k(K,"class","tabs-content"),k(U,"class","tabs")},m(e,l){d(e,o,l),t(o,a),t(o,m),t(o,b),d(e,r,l),d(e,h,l),t(h,g),t(g,$),t(g,_),t(_,ie),t(g,De),t(g,re),t(g,Ue),d(e,ce,l),oe(R,e,l),d(e,de,l),d(e,q,l),d(e,pe,l),d(e,C,l),t(C,x),t(C,We),t(C,ee),t(ee,H),t(H,Fe),t(H,ue),t(ue,he),t(H,Me),d(e,be,l),d(e,j,l),d(e,fe,l),d(e,O,l),t(O,me),t(O,Be),t(O,E),t(E,T),t(T,_e),t(T,Le),t(T,ke),t(T,qe),t(T,N);for(let p=0;p<S.length;p+=1)S[p]&&S[p].m(N,null);t(N,ge),t(E,He),t(E,ve),d(e,Se,l),d(e,V,l),d(e,we,l),d(e,A,l),t(A,ye),t(A,je),t(A,Y),t(Y,D),t(D,$e),t(D,Ee),t(D,Pe),t(D,Ne),t(D,v),t(v,Ve),oe(F,v,null),t(v,Ye),t(v,Je),t(v,Ie),t(v,Re),t(v,Ke),t(v,Ce),t(v,Qe),t(v,ze),t(v,Ge),t(v,Oe),t(v,Ze),t(Y,Xe),oe(M,Y,null),d(e,Te,l),d(e,J,l),d(e,Ae,l),d(e,U,l),t(U,I);for(let p=0;p<P.length;p+=1)P[p]&&P[p].m(I,null);t(U,et),t(U,K);for(let p=0;p<w.length;p+=1)w[p]&&w[p].m(K,null);W=!0},p(e,[l]){var nt,it;(!W||l&1)&&n!==(n=e[0].name+"")&&Z(m,n),(!W||l&2)&&X!==(X=e[1].join("/")+"")&&Z(ie,X);const p={};if(l&49&&(p.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${e[5]}');

        ...

        const authData = await pb.collection('${(nt=e[0])==null?void 0:nt.name}').authWithPassword(
            '${e[4]}',
            'YOUR_PASSWORD',
        );

        // after the above you can also access the auth data from the authStore
        console.log(pb.authStore.isValid);
        console.log(pb.authStore.token);
        console.log(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `),l&49&&(p.dart=`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${e[5]}');

        ...

        final authData = await pb.collection('${(it=e[0])==null?void 0:it.name}').authWithPassword(
          '${e[4]}',
          'YOUR_PASSWORD',
        );

        // after the above you can also access the auth data from the authStore
        print(pb.authStore.isValid);
        print(pb.authStore.token);
        print(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `),R.$set(p),(!W||l&1)&&te!==(te=e[0].name+"")&&Z(he,te),l&2){B=L(e[1]);let y;for(y=0;y<B.length;y+=1){const rt=ht(e,B,y);S[y]?S[y].p(rt,l):(S[y]=bt(rt),S[y].c(),S[y].m(N,ge))}for(;y<S.length;y+=1)S[y].d(1);S.length=B.length}l&12&&(le=L(e[3]),P=ct(P,l,lt,1,e,le,xe,I,yt,ft,null,ut)),l&12&&(Q=L(e[3]),$t(),w=ct(w,l,at,1,e,Q,tt,K,Pt,mt,null,pt),Rt())},i(e){if(!W){G(R.$$.fragment,e),G(F.$$.fragment,e),G(M.$$.fragment,e);for(let l=0;l<Q.length;l+=1)G(w[l]);W=!0}},o(e){z(R.$$.fragment,e),z(F.$$.fragment,e),z(M.$$.fragment,e);for(let l=0;l<w.length;l+=1)z(w[l]);W=!1},d(e){e&&(c(o),c(r),c(h),c(ce),c(de),c(q),c(pe),c(C),c(be),c(j),c(fe),c(O),c(Se),c(V),c(we),c(A),c(Te),c(J),c(Ae),c(U)),ae(R,e),wt(S,e),ae(F),ae(M);for(let l=0;l<P.length;l+=1)P[l].d();for(let l=0;l<w.length;l+=1)w[l].d()}}}function Ut(i,o,a){let n,m,b,{collection:r}=o,h=200,g=[];const $=_=>a(2,h=_.code);return i.$$set=_=>{"collection"in _&&a(0,r=_.collection)},i.$$.update=()=>{var _;i.$$.dirty&1&&a(1,m=((_=r==null?void 0:r.passwordAuth)==null?void 0:_.identityFields)||[]),i.$$.dirty&2&&a(4,b=m.length==0?"NONE":"YOUR_"+m.join("_OR_").toUpperCase()),i.$$.dirty&1&&a(3,g=[{code:200,body:JSON.stringify({token:"JWT_TOKEN",record:dt.dummyCollectionRecord(r)},null,2)},{code:400,body:`
                {
                  "status": 400,
                  "message": "Failed to authenticate.",
                  "data": {
                    "identity": {
                      "code": "validation_required",
                      "message": "Missing required value."
                    }
                  }
                }
            `}])},a(5,n=dt.getApiExampleUrl(Ct.baseURL)),[r,m,h,g,b,n,$]}class Mt extends kt{constructor(o){super(),gt(this,o,Ut,Dt,vt,{collection:0})}}export{Mt as default};
