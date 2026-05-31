import{d as Be,E as Ce,U as Te,S as Le,z as J,w as u,u as ae,a3 as N,a2 as Q,V as z,a4 as ye,t as Se,D as Ue,N as je,l as De,G as d,i as a,K as ne,x as c,_ as $,Z as k,s as ie,j as h,P as oe,b as Ee,a0 as I,J as Re,a as qe}from"./index-DiFYKP__.js";import{F as Fe}from"./FieldsQueryParam-Dol1zKfT.js";function $e(n,s,l){const o=n.slice();return o[8]=s[l],o}function Me(n,s,l){const o=n.slice();return o[8]=s[l],o}function Ae(n,s){let l,o=s[8].code+"",p,b,i,f;function m(){return s[6](s[8])}return{key:n,first:null,c(){l=c("button"),p=$(o),b=k(),h(l,"class","tab-item"),I(l,"active",s[1]===s[8].code),this.first=l},m(v,w){d(v,l,w),a(l,p),a(l,b),i||(f=Re(l,"click",m),i=!0)},p(v,w){s=v,w&4&&o!==(o=s[8].code+"")&&z(p,o),w&6&&I(l,"active",s[1]===s[8].code)},d(v){v&&u(l),i=!1,f()}}}function Pe(n,s){let l,o,p,b;return o=new qe({props:{content:s[8].body}}),{key:n,first:null,c(){l=c("div"),ie(o.$$.fragment),p=k(),h(l,"class","tab-item"),I(l,"active",s[1]===s[8].code),this.first=l},m(i,f){d(i,l,f),ne(o,l,null),a(l,p),b=!0},p(i,f){s=i;const m={};f&4&&(m.content=s[8].body),o.$set(m),(!b||f&6)&&I(l,"active",s[1]===s[8].code)},i(i){b||(Q(o.$$.fragment,i),b=!0)},o(i){N(o.$$.fragment,i),b=!1},d(i){i&&u(l),ae(o)}}}function Ge(n){var ke,ge;let s,l,o=n[0].name+"",p,b,i,f,m,v,w,g=n[0].name+"",K,ce,O,M,V,L,Z,A,q,re,F,S,ue,W,G=n[0].name+"",X,de,Y,U,x,P,ee,fe,te,T,le,j,se,B,D,y=[],me=new Map,pe,E,_=[],be=new Map,C;M=new Le({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${n[3]}');

        ...

        const result = await pb.collection('${(ke=n[0])==null?void 0:ke.name}').listAuthMethods();
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${n[3]}');

        ...

        final result = await pb.collection('${(ge=n[0])==null?void 0:ge.name}').listAuthMethods();
    `}}),T=new Fe({});let H=J(n[2]);const he=e=>e[8].code;for(let e=0;e<H.length;e+=1){let t=Me(n,H,e),r=he(t);me.set(r,y[e]=Ae(r,t))}let R=J(n[2]);const _e=e=>e[8].code;for(let e=0;e<R.length;e+=1){let t=$e(n,R,e),r=_e(t);be.set(r,_[e]=Pe(r,t))}return{c(){s=c("h3"),l=$("List auth methods ("),p=$(o),b=$(")"),i=k(),f=c("div"),m=c("p"),v=$("Returns a public list with all allowed "),w=c("strong"),K=$(g),ce=$(" authentication methods."),O=k(),ie(M.$$.fragment),V=k(),L=c("h6"),L.textContent="API details",Z=k(),A=c("div"),q=c("strong"),q.textContent="GET",re=k(),F=c("div"),S=c("p"),ue=$("/api/collections/"),W=c("strong"),X=$(G),de=$("/auth-methods"),Y=k(),U=c("div"),U.textContent="Query parameters",x=k(),P=c("table"),ee=c("thead"),ee.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr>',fe=k(),te=c("tbody"),ie(T.$$.fragment),le=k(),j=c("div"),j.textContent="Responses",se=k(),B=c("div"),D=c("div");for(let e=0;e<y.length;e+=1)y[e].c();pe=k(),E=c("div");for(let e=0;e<_.length;e+=1)_[e].c();h(s,"class","m-b-sm"),h(f,"class","content txt-lg m-b-sm"),h(L,"class","m-b-xs"),h(q,"class","label label-primary"),h(F,"class","content"),h(A,"class","alert alert-info"),h(U,"class","section-title"),h(P,"class","table-compact table-border m-b-base"),h(j,"class","section-title"),h(D,"class","tabs-header compact combined left"),h(E,"class","tabs-content"),h(B,"class","tabs")},m(e,t){d(e,s,t),a(s,l),a(s,p),a(s,b),d(e,i,t),d(e,f,t),a(f,m),a(m,v),a(m,w),a(w,K),a(m,ce),d(e,O,t),ne(M,e,t),d(e,V,t),d(e,L,t),d(e,Z,t),d(e,A,t),a(A,q),a(A,re),a(A,F),a(F,S),a(S,ue),a(S,W),a(W,X),a(S,de),d(e,Y,t),d(e,U,t),d(e,x,t),d(e,P,t),a(P,ee),a(P,fe),a(P,te),ne(T,te,null),d(e,le,t),d(e,j,t),d(e,se,t),d(e,B,t),a(B,D);for(let r=0;r<y.length;r+=1)y[r]&&y[r].m(D,null);a(B,pe),a(B,E);for(let r=0;r<_.length;r+=1)_[r]&&_[r].m(E,null);C=!0},p(e,[t]){var ve,we;(!C||t&1)&&o!==(o=e[0].name+"")&&z(p,o),(!C||t&1)&&g!==(g=e[0].name+"")&&z(K,g);const r={};t&9&&(r.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${e[3]}');

        ...

        const result = await pb.collection('${(ve=e[0])==null?void 0:ve.name}').listAuthMethods();
    `),t&9&&(r.dart=`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${e[3]}');

        ...

        final result = await pb.collection('${(we=e[0])==null?void 0:we.name}').listAuthMethods();
    `),M.$set(r),(!C||t&1)&&G!==(G=e[0].name+"")&&z(X,G),t&6&&(H=J(e[2]),y=ye(y,t,he,1,e,H,me,D,Se,Ae,null,Me)),t&6&&(R=J(e[2]),Ue(),_=ye(_,t,_e,1,e,R,be,E,je,Pe,null,$e),De())},i(e){if(!C){Q(M.$$.fragment,e),Q(T.$$.fragment,e);for(let t=0;t<R.length;t+=1)Q(_[t]);C=!0}},o(e){N(M.$$.fragment,e),N(T.$$.fragment,e);for(let t=0;t<_.length;t+=1)N(_[t]);C=!1},d(e){e&&(u(s),u(i),u(f),u(O),u(V),u(L),u(Z),u(A),u(Y),u(U),u(x),u(P),u(le),u(j),u(se),u(B)),ae(M,e),ae(T);for(let t=0;t<y.length;t+=1)y[t].d();for(let t=0;t<_.length;t+=1)_[t].d()}}}function He(n,s,l){let o,{collection:p}=s,b=200,i=[],f={},m=!1;v();async function v(){l(5,m=!0);try{l(4,f=await oe.collection(p.name).listAuthMethods())}catch(g){oe.error(g)}l(5,m=!1)}const w=g=>l(1,b=g.code);return n.$$set=g=>{"collection"in g&&l(0,p=g.collection)},n.$$.update=()=>{n.$$.dirty&48&&l(2,i=[{code:200,body:m?"...":JSON.stringify(f,null,2)},{code:404,body:`
                {
                  "status": 404,
                  "message": "Missing collection context.",
                  "data": {}
                }
            `}])},l(3,o=Ee.getApiExampleUrl(oe.baseURL)),[p,b,i,o,f,m,w]}class Qe extends Be{constructor(s){super(),Ce(this,s,He,Ge,Te,{collection:0})}}export{Qe as default};
