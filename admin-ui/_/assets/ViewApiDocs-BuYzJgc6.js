import{d as lt,E as st,U as nt,S as at,a as tt,z as Q,w as r,u as Z,a3 as j,a2 as N,V as ve,a4 as Ke,t as ot,D as it,N as rt,l as dt,G as d,i as l,K as W,x as a,_,Z as b,s as X,j as m,b as Qe,P as ct,a0 as Y,J as pt}from"./index-DiFYKP__.js";import{F as ut}from"./FieldsQueryParam-Dol1zKfT.js";function Ze(o,s,n){const i=o.slice();return i[6]=s[n],i}function We(o,s,n){const i=o.slice();return i[6]=s[n],i}function Xe(o){let s;return{c(){s=a("p"),s.innerHTML="Requires superuser <code>Authorization:TOKEN</code> header",m(s,"class","txt-hint txt-sm txt-right")},m(n,i){d(n,s,i)},d(n){n&&r(s)}}}function Ye(o,s){let n,i,v;function p(){return s[5](s[6])}return{key:o,first:null,c(){n=a("button"),n.textContent=`${s[6].code} `,m(n,"class","tab-item"),Y(n,"active",s[2]===s[6].code),this.first=n},m(c,f){d(c,n,f),i||(v=pt(n,"click",p),i=!0)},p(c,f){s=c,f&20&&Y(n,"active",s[2]===s[6].code)},d(c){c&&r(n),i=!1,v()}}}function et(o,s){let n,i,v,p;return i=new tt({props:{content:s[6].body}}),{key:o,first:null,c(){n=a("div"),X(i.$$.fragment),v=b(),m(n,"class","tab-item"),Y(n,"active",s[2]===s[6].code),this.first=n},m(c,f){d(c,n,f),W(i,n,null),l(n,v),p=!0},p(c,f){s=c,(!p||f&20)&&Y(n,"active",s[2]===s[6].code)},i(c){p||(N(i.$$.fragment,c),p=!0)},o(c){j(i.$$.fragment,c),p=!1},d(c){c&&r(n),Z(i)}}}function ft(o){var Ve,ze;let s,n,i=o[0].name+"",v,p,c,f,w,C,ee,V=o[0].name+"",te,$e,le,F,se,B,ne,$,z,ye,G,T,we,ae,J=o[0].name+"",oe,Ce,ie,Fe,re,S,de,A,ce,I,pe,R,ue,Re,M,D,fe,De,be,Oe,h,Pe,E,Te,Ee,xe,me,Be,_e,Se,Ae,Ie,he,Me,qe,x,ke,q,ge,O,H,y=[],He=new Map,Le,L,k=[],Ue=new Map,P;F=new at({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${o[3]}');

        ...

        const record = await pb.collection('${(Ve=o[0])==null?void 0:Ve.name}').getOne('RECORD_ID', {
            expand: 'relField1,relField2.subRelField',
        });
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${o[3]}');

        ...

        final record = await pb.collection('${(ze=o[0])==null?void 0:ze.name}').getOne('RECORD_ID',
          expand: 'relField1,relField2.subRelField',
        );
    `}});let g=o[1]&&Xe();E=new tt({props:{content:"?expand=relField1,relField2.subRelField"}}),x=new ut({});let K=Q(o[4]);const je=e=>e[6].code;for(let e=0;e<K.length;e+=1){let t=We(o,K,e),u=je(t);He.set(u,y[e]=Ye(u,t))}let U=Q(o[4]);const Ne=e=>e[6].code;for(let e=0;e<U.length;e+=1){let t=Ze(o,U,e),u=Ne(t);Ue.set(u,k[e]=et(u,t))}return{c(){s=a("h3"),n=_("View ("),v=_(i),p=_(")"),c=b(),f=a("div"),w=a("p"),C=_("Fetch a single "),ee=a("strong"),te=_(V),$e=_(" record."),le=b(),X(F.$$.fragment),se=b(),B=a("h6"),B.textContent="API details",ne=b(),$=a("div"),z=a("strong"),z.textContent="GET",ye=b(),G=a("div"),T=a("p"),we=_("/api/collections/"),ae=a("strong"),oe=_(J),Ce=_("/records/"),ie=a("strong"),ie.textContent=":id",Fe=b(),g&&g.c(),re=b(),S=a("div"),S.textContent="Path Parameters",de=b(),A=a("table"),A.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr></thead> <tbody><tr><td>id</td> <td><span class="label">String</span></td> <td>ID of the record to view.</td></tr></tbody>',ce=b(),I=a("div"),I.textContent="Query parameters",pe=b(),R=a("table"),ue=a("thead"),ue.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr>',Re=b(),M=a("tbody"),D=a("tr"),fe=a("td"),fe.textContent="expand",De=b(),be=a("td"),be.innerHTML='<span class="label">String</span>',Oe=b(),h=a("td"),Pe=_(`Auto expand record relations. Ex.:
                `),X(E.$$.fragment),Te=_(`
                Supports up to 6-levels depth nested relations expansion. `),Ee=a("br"),xe=_(`
                The expanded relations will be appended to the record under the
                `),me=a("code"),me.textContent="expand",Be=_(" property (eg. "),_e=a("code"),_e.textContent='"expand": {"relField1": {...}, ...}',Se=_(`).
                `),Ae=a("br"),Ie=_(`
                Only the relations to which the request user has permissions to `),he=a("strong"),he.textContent="view",Me=_(" will be expanded."),qe=b(),X(x.$$.fragment),ke=b(),q=a("div"),q.textContent="Responses",ge=b(),O=a("div"),H=a("div");for(let e=0;e<y.length;e+=1)y[e].c();Le=b(),L=a("div");for(let e=0;e<k.length;e+=1)k[e].c();m(s,"class","m-b-sm"),m(f,"class","content txt-lg m-b-sm"),m(B,"class","m-b-xs"),m(z,"class","label label-primary"),m(G,"class","content"),m($,"class","alert alert-info"),m(S,"class","section-title"),m(A,"class","table-compact table-border m-b-base"),m(I,"class","section-title"),m(R,"class","table-compact table-border m-b-base"),m(q,"class","section-title"),m(H,"class","tabs-header compact combined left"),m(L,"class","tabs-content"),m(O,"class","tabs")},m(e,t){d(e,s,t),l(s,n),l(s,v),l(s,p),d(e,c,t),d(e,f,t),l(f,w),l(w,C),l(w,ee),l(ee,te),l(w,$e),d(e,le,t),W(F,e,t),d(e,se,t),d(e,B,t),d(e,ne,t),d(e,$,t),l($,z),l($,ye),l($,G),l(G,T),l(T,we),l(T,ae),l(ae,oe),l(T,Ce),l(T,ie),l($,Fe),g&&g.m($,null),d(e,re,t),d(e,S,t),d(e,de,t),d(e,A,t),d(e,ce,t),d(e,I,t),d(e,pe,t),d(e,R,t),l(R,ue),l(R,Re),l(R,M),l(M,D),l(D,fe),l(D,De),l(D,be),l(D,Oe),l(D,h),l(h,Pe),W(E,h,null),l(h,Te),l(h,Ee),l(h,xe),l(h,me),l(h,Be),l(h,_e),l(h,Se),l(h,Ae),l(h,Ie),l(h,he),l(h,Me),l(M,qe),W(x,M,null),d(e,ke,t),d(e,q,t),d(e,ge,t),d(e,O,t),l(O,H);for(let u=0;u<y.length;u+=1)y[u]&&y[u].m(H,null);l(O,Le),l(O,L);for(let u=0;u<k.length;u+=1)k[u]&&k[u].m(L,null);P=!0},p(e,[t]){var Ge,Je;(!P||t&1)&&i!==(i=e[0].name+"")&&ve(v,i),(!P||t&1)&&V!==(V=e[0].name+"")&&ve(te,V);const u={};t&9&&(u.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${e[3]}');

        ...

        const record = await pb.collection('${(Ge=e[0])==null?void 0:Ge.name}').getOne('RECORD_ID', {
            expand: 'relField1,relField2.subRelField',
        });
    `),t&9&&(u.dart=`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${e[3]}');

        ...

        final record = await pb.collection('${(Je=e[0])==null?void 0:Je.name}').getOne('RECORD_ID',
          expand: 'relField1,relField2.subRelField',
        );
    `),F.$set(u),(!P||t&1)&&J!==(J=e[0].name+"")&&ve(oe,J),e[1]?g||(g=Xe(),g.c(),g.m($,null)):g&&(g.d(1),g=null),t&20&&(K=Q(e[4]),y=Ke(y,t,je,1,e,K,He,H,ot,Ye,null,We)),t&20&&(U=Q(e[4]),it(),k=Ke(k,t,Ne,1,e,U,Ue,L,rt,et,null,Ze),dt())},i(e){if(!P){N(F.$$.fragment,e),N(E.$$.fragment,e),N(x.$$.fragment,e);for(let t=0;t<U.length;t+=1)N(k[t]);P=!0}},o(e){j(F.$$.fragment,e),j(E.$$.fragment,e),j(x.$$.fragment,e);for(let t=0;t<k.length;t+=1)j(k[t]);P=!1},d(e){e&&(r(s),r(c),r(f),r(le),r(se),r(B),r(ne),r($),r(re),r(S),r(de),r(A),r(ce),r(I),r(pe),r(R),r(ke),r(q),r(ge),r(O)),Z(F,e),g&&g.d(),Z(E),Z(x);for(let t=0;t<y.length;t+=1)y[t].d();for(let t=0;t<k.length;t+=1)k[t].d()}}}function bt(o,s,n){let i,v,{collection:p}=s,c=200,f=[];const w=C=>n(2,c=C.code);return o.$$set=C=>{"collection"in C&&n(0,p=C.collection)},o.$$.update=()=>{o.$$.dirty&1&&n(1,i=(p==null?void 0:p.viewRule)===null),o.$$.dirty&3&&p!=null&&p.id&&(f.push({code:200,body:JSON.stringify(Qe.dummyCollectionRecord(p),null,2)}),i&&f.push({code:403,body:`
                    {
                      "status": 403,
                      "message": "Only superusers can access this action.",
                      "data": {}
                    }
                `}),f.push({code:404,body:`
                {
                  "status": 404,
                  "message": "The requested resource wasn't found.",
                  "data": {}
                }
            `}))},n(3,v=Qe.getApiExampleUrl(ct.baseURL)),[p,i,c,v,f,w]}class ht extends lt{constructor(s){super(),st(this,s,bt,ft,nt,{collection:0})}}export{ht as default};
