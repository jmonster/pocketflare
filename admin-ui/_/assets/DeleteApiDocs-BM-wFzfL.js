import{d as Re,E as Ee,U as Pe,S as Te,z as H,w as p,u as $e,a3 as te,a2 as le,V as ee,a4 as he,t as Be,D as Oe,N as Ie,l as Ae,G as f,i,K as we,x as c,_ as y,Z as k,s as Ce,j as m,b as Me,P as qe,a0 as z,J as Le,a as Se}from"./index-Ckgw6Jlu.js";function ke(a,l,s){const n=a.slice();return n[6]=l[s],n}function ge(a,l,s){const n=a.slice();return n[6]=l[s],n}function ve(a){let l;return{c(){l=c("p"),l.innerHTML="Requires superuser <code>Authorization:TOKEN</code> header",m(l,"class","txt-hint txt-sm txt-right")},m(s,n){f(s,l,n)},d(s){s&&p(l)}}}function ye(a,l){let s,n,h;function r(){return l[5](l[6])}return{key:a,first:null,c(){s=c("button"),s.textContent=`${l[6].code} `,m(s,"class","tab-item"),z(s,"active",l[2]===l[6].code),this.first=s},m(o,d){f(o,s,d),n||(h=Le(s,"click",r),n=!0)},p(o,d){l=o,d&20&&z(s,"active",l[2]===l[6].code)},d(o){o&&p(s),n=!1,h()}}}function De(a,l){let s,n,h,r;return n=new Se({props:{content:l[6].body}}),{key:a,first:null,c(){s=c("div"),Ce(n.$$.fragment),h=k(),m(s,"class","tab-item"),z(s,"active",l[2]===l[6].code),this.first=s},m(o,d){f(o,s,d),we(n,s,null),i(s,h),r=!0},p(o,d){l=o,(!r||d&20)&&z(s,"active",l[2]===l[6].code)},i(o){r||(le(n.$$.fragment,o),r=!0)},o(o){te(n.$$.fragment,o),r=!1},d(o){o&&p(s),$e(n)}}}function Ue(a){var fe,me;let l,s,n=a[0].name+"",h,r,o,d,D,$,K,q=a[0].name+"",N,se,F,w,G,P,J,g,L,ae,S,E,ne,V,U=a[0].name+"",Z,oe,Q,ie,W,T,X,B,Y,O,x,C,I,v=[],ce=new Map,re,A,b=[],de=new Map,R;w=new Te({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${a[3]}');

        ...

        await pb.collection('${(fe=a[0])==null?void 0:fe.name}').delete('RECORD_ID');
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${a[3]}');

        ...

        await pb.collection('${(me=a[0])==null?void 0:me.name}').delete('RECORD_ID');
    `}});let _=a[1]&&ve(),j=H(a[4]);const ue=e=>e[6].code;for(let e=0;e<j.length;e+=1){let t=ge(a,j,e),u=ue(t);ce.set(u,v[e]=ye(u,t))}let M=H(a[4]);const pe=e=>e[6].code;for(let e=0;e<M.length;e+=1){let t=ke(a,M,e),u=pe(t);de.set(u,b[e]=De(u,t))}return{c(){l=c("h3"),s=y("Delete ("),h=y(n),r=y(")"),o=k(),d=c("div"),D=c("p"),$=y("Delete a single "),K=c("strong"),N=y(q),se=y(" record."),F=k(),Ce(w.$$.fragment),G=k(),P=c("h6"),P.textContent="API details",J=k(),g=c("div"),L=c("strong"),L.textContent="DELETE",ae=k(),S=c("div"),E=c("p"),ne=y("/api/collections/"),V=c("strong"),Z=y(U),oe=y("/records/"),Q=c("strong"),Q.textContent=":id",ie=k(),_&&_.c(),W=k(),T=c("div"),T.textContent="Path parameters",X=k(),B=c("table"),B.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr></thead> <tbody><tr><td>id</td> <td><span class="label">String</span></td> <td>ID of the record to delete.</td></tr></tbody>',Y=k(),O=c("div"),O.textContent="Responses",x=k(),C=c("div"),I=c("div");for(let e=0;e<v.length;e+=1)v[e].c();re=k(),A=c("div");for(let e=0;e<b.length;e+=1)b[e].c();m(l,"class","m-b-sm"),m(d,"class","content txt-lg m-b-sm"),m(P,"class","m-b-xs"),m(L,"class","label label-primary"),m(S,"class","content"),m(g,"class","alert alert-danger"),m(T,"class","section-title"),m(B,"class","table-compact table-border m-b-base"),m(O,"class","section-title"),m(I,"class","tabs-header compact combined left"),m(A,"class","tabs-content"),m(C,"class","tabs")},m(e,t){f(e,l,t),i(l,s),i(l,h),i(l,r),f(e,o,t),f(e,d,t),i(d,D),i(D,$),i(D,K),i(K,N),i(D,se),f(e,F,t),we(w,e,t),f(e,G,t),f(e,P,t),f(e,J,t),f(e,g,t),i(g,L),i(g,ae),i(g,S),i(S,E),i(E,ne),i(E,V),i(V,Z),i(E,oe),i(E,Q),i(g,ie),_&&_.m(g,null),f(e,W,t),f(e,T,t),f(e,X,t),f(e,B,t),f(e,Y,t),f(e,O,t),f(e,x,t),f(e,C,t),i(C,I);for(let u=0;u<v.length;u+=1)v[u]&&v[u].m(I,null);i(C,re),i(C,A);for(let u=0;u<b.length;u+=1)b[u]&&b[u].m(A,null);R=!0},p(e,[t]){var be,_e;(!R||t&1)&&n!==(n=e[0].name+"")&&ee(h,n),(!R||t&1)&&q!==(q=e[0].name+"")&&ee(N,q);const u={};t&9&&(u.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${e[3]}');

        ...

        await pb.collection('${(be=e[0])==null?void 0:be.name}').delete('RECORD_ID');
    `),t&9&&(u.dart=`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${e[3]}');

        ...

        await pb.collection('${(_e=e[0])==null?void 0:_e.name}').delete('RECORD_ID');
    `),w.$set(u),(!R||t&1)&&U!==(U=e[0].name+"")&&ee(Z,U),e[1]?_||(_=ve(),_.c(),_.m(g,null)):_&&(_.d(1),_=null),t&20&&(j=H(e[4]),v=he(v,t,ue,1,e,j,ce,I,Be,ye,null,ge)),t&20&&(M=H(e[4]),Oe(),b=he(b,t,pe,1,e,M,de,A,Ie,De,null,ke),Ae())},i(e){if(!R){le(w.$$.fragment,e);for(let t=0;t<M.length;t+=1)le(b[t]);R=!0}},o(e){te(w.$$.fragment,e);for(let t=0;t<b.length;t+=1)te(b[t]);R=!1},d(e){e&&(p(l),p(o),p(d),p(F),p(G),p(P),p(J),p(g),p(W),p(T),p(X),p(B),p(Y),p(O),p(x),p(C)),$e(w,e),_&&_.d();for(let t=0;t<v.length;t+=1)v[t].d();for(let t=0;t<b.length;t+=1)b[t].d()}}}function je(a,l,s){let n,h,{collection:r}=l,o=204,d=[];const D=$=>s(2,o=$.code);return a.$$set=$=>{"collection"in $&&s(0,r=$.collection)},a.$$.update=()=>{a.$$.dirty&1&&s(1,n=(r==null?void 0:r.deleteRule)===null),a.$$.dirty&3&&r!=null&&r.id&&(d.push({code:204,body:`
                null
            `}),d.push({code:400,body:`
                {
                  "status": 400,
                  "message": "Failed to delete record. Make sure that the record is not part of a required relation reference.",
                  "data": {}
                }
            `}),n&&d.push({code:403,body:`
                    {
                      "status": 403,
                      "message": "Only superusers can access this action.",
                      "data": {}
                    }
                `}),d.push({code:404,body:`
                {
                  "status": 404,
                  "message": "The requested resource wasn't found.",
                  "data": {}
                }
            `}))},s(3,h=Me.getApiExampleUrl(qe.baseURL)),[r,n,o,h,d,D]}class ze extends Re{constructor(l){super(),Ee(this,l,je,Ue,Pe,{collection:0})}}export{ze as default};
