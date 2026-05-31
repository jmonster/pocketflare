import{d as le,E as ne,U as ie,z as K,w as b,a3 as L,a2 as H,V as Z,a4 as x,t as Te,D as ee,N as qe,l as te,G as h,i as u,x as m,Z as y,_ as N,j as v,a0 as F,J as oe,a as Ce,u as W,K as X,s as Y,S as Ve,v as fe,b as Pe,P as Ae,q as ue}from"./index-B4OIv7rD.js";function de(s,t,e){const o=s.slice();return o[4]=t[e],o}function me(s,t,e){const o=s.slice();return o[4]=t[e],o}function pe(s,t){let e,o=t[4].code+"",f,c,r,a;function d(){return t[3](t[4])}return{key:s,first:null,c(){e=m("button"),f=N(o),c=y(),v(e,"class","tab-item"),F(e,"active",t[1]===t[4].code),this.first=e},m(g,q){h(g,e,q),u(e,f),u(e,c),r||(a=oe(e,"click",d),r=!0)},p(g,q){t=g,q&4&&o!==(o=t[4].code+"")&&Z(f,o),q&6&&F(e,"active",t[1]===t[4].code)},d(g){g&&b(e),r=!1,a()}}}function _e(s,t){let e,o,f,c;return o=new Ce({props:{content:t[4].body}}),{key:s,first:null,c(){e=m("div"),Y(o.$$.fragment),f=y(),v(e,"class","tab-item"),F(e,"active",t[1]===t[4].code),this.first=e},m(r,a){h(r,e,a),X(o,e,null),u(e,f),c=!0},p(r,a){t=r;const d={};a&4&&(d.content=t[4].body),o.$set(d),(!c||a&6)&&F(e,"active",t[1]===t[4].code)},i(r){c||(H(o.$$.fragment,r),c=!0)},o(r){L(o.$$.fragment,r),c=!1},d(r){r&&b(e),W(o)}}}function Ie(s){let t,e,o,f,c,r,a,d=s[0].name+"",g,q,D,I,j,R,B,E,M,C,V,$=[],z=new Map,U,A,p=[],T=new Map,P,_=K(s[2]);const J=l=>l[4].code;for(let l=0;l<_.length;l+=1){let i=me(s,_,l),n=J(i);z.set(n,$[l]=pe(n,i))}let O=K(s[2]);const G=l=>l[4].code;for(let l=0;l<O.length;l+=1){let i=de(s,O,l),n=G(i);T.set(n,p[l]=_e(n,i))}return{c(){t=m("div"),e=m("strong"),e.textContent="POST",o=y(),f=m("div"),c=m("p"),r=N("/api/collections/"),a=m("strong"),g=N(d),q=N("/confirm-verification"),D=y(),I=m("div"),I.textContent="Body Parameters",j=y(),R=m("table"),R.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr></thead> <tbody><tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>token</span></div></td> <td><span class="label">String</span></td> <td>The token from the verification request email.</td></tr></tbody>',B=y(),E=m("div"),E.textContent="Responses",M=y(),C=m("div"),V=m("div");for(let l=0;l<$.length;l+=1)$[l].c();U=y(),A=m("div");for(let l=0;l<p.length;l+=1)p[l].c();v(e,"class","label label-primary"),v(f,"class","content"),v(t,"class","alert alert-success"),v(I,"class","section-title"),v(R,"class","table-compact table-border m-b-base"),v(E,"class","section-title"),v(V,"class","tabs-header compact combined left"),v(A,"class","tabs-content"),v(C,"class","tabs")},m(l,i){h(l,t,i),u(t,e),u(t,o),u(t,f),u(f,c),u(c,r),u(c,a),u(a,g),u(c,q),h(l,D,i),h(l,I,i),h(l,j,i),h(l,R,i),h(l,B,i),h(l,E,i),h(l,M,i),h(l,C,i),u(C,V);for(let n=0;n<$.length;n+=1)$[n]&&$[n].m(V,null);u(C,U),u(C,A);for(let n=0;n<p.length;n+=1)p[n]&&p[n].m(A,null);P=!0},p(l,[i]){(!P||i&1)&&d!==(d=l[0].name+"")&&Z(g,d),i&6&&(_=K(l[2]),$=x($,i,J,1,l,_,z,V,Te,pe,null,me)),i&6&&(O=K(l[2]),ee(),p=x(p,i,G,1,l,O,T,A,qe,_e,null,de),te())},i(l){if(!P){for(let i=0;i<O.length;i+=1)H(p[i]);P=!0}},o(l){for(let i=0;i<p.length;i+=1)L(p[i]);P=!1},d(l){l&&(b(t),b(D),b(I),b(j),b(R),b(B),b(E),b(M),b(C));for(let i=0;i<$.length;i+=1)$[i].d();for(let i=0;i<p.length;i+=1)p[i].d()}}}function Re(s,t,e){let{collection:o}=t,f=204,c=[];const r=a=>e(1,f=a.code);return s.$$set=a=>{"collection"in a&&e(0,o=a.collection)},e(2,c=[{code:204,body:"null"},{code:400,body:`
                {
                  "status": 400,
                  "message": "An error occurred while validating the submitted data.",
                  "data": {
                    "token": {
                      "code": "validation_required",
                      "message": "Missing required value."
                    }
                  }
                }
            `}]),[o,f,c,r]}class Be extends le{constructor(t){super(),ne(this,t,Re,Ie,ie,{collection:0})}}function be(s,t,e){const o=s.slice();return o[4]=t[e],o}function he(s,t,e){const o=s.slice();return o[4]=t[e],o}function ve(s,t){let e,o=t[4].code+"",f,c,r,a;function d(){return t[3](t[4])}return{key:s,first:null,c(){e=m("button"),f=N(o),c=y(),v(e,"class","tab-item"),F(e,"active",t[1]===t[4].code),this.first=e},m(g,q){h(g,e,q),u(e,f),u(e,c),r||(a=oe(e,"click",d),r=!0)},p(g,q){t=g,q&4&&o!==(o=t[4].code+"")&&Z(f,o),q&6&&F(e,"active",t[1]===t[4].code)},d(g){g&&b(e),r=!1,a()}}}function ge(s,t){let e,o,f,c;return o=new Ce({props:{content:t[4].body}}),{key:s,first:null,c(){e=m("div"),Y(o.$$.fragment),f=y(),v(e,"class","tab-item"),F(e,"active",t[1]===t[4].code),this.first=e},m(r,a){h(r,e,a),X(o,e,null),u(e,f),c=!0},p(r,a){t=r;const d={};a&4&&(d.content=t[4].body),o.$set(d),(!c||a&6)&&F(e,"active",t[1]===t[4].code)},i(r){c||(H(o.$$.fragment,r),c=!0)},o(r){L(o.$$.fragment,r),c=!1},d(r){r&&b(e),W(o)}}}function Ee(s){let t,e,o,f,c,r,a,d=s[0].name+"",g,q,D,I,j,R,B,E,M,C,V,$=[],z=new Map,U,A,p=[],T=new Map,P,_=K(s[2]);const J=l=>l[4].code;for(let l=0;l<_.length;l+=1){let i=he(s,_,l),n=J(i);z.set(n,$[l]=ve(n,i))}let O=K(s[2]);const G=l=>l[4].code;for(let l=0;l<O.length;l+=1){let i=be(s,O,l),n=G(i);T.set(n,p[l]=ge(n,i))}return{c(){t=m("div"),e=m("strong"),e.textContent="POST",o=y(),f=m("div"),c=m("p"),r=N("/api/collections/"),a=m("strong"),g=N(d),q=N("/request-verification"),D=y(),I=m("div"),I.textContent="Body Parameters",j=y(),R=m("table"),R.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr></thead> <tbody><tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>email</span></div></td> <td><span class="label">String</span></td> <td>The auth record email address to send the verification request (if exists).</td></tr></tbody>',B=y(),E=m("div"),E.textContent="Responses",M=y(),C=m("div"),V=m("div");for(let l=0;l<$.length;l+=1)$[l].c();U=y(),A=m("div");for(let l=0;l<p.length;l+=1)p[l].c();v(e,"class","label label-primary"),v(f,"class","content"),v(t,"class","alert alert-success"),v(I,"class","section-title"),v(R,"class","table-compact table-border m-b-base"),v(E,"class","section-title"),v(V,"class","tabs-header compact combined left"),v(A,"class","tabs-content"),v(C,"class","tabs")},m(l,i){h(l,t,i),u(t,e),u(t,o),u(t,f),u(f,c),u(c,r),u(c,a),u(a,g),u(c,q),h(l,D,i),h(l,I,i),h(l,j,i),h(l,R,i),h(l,B,i),h(l,E,i),h(l,M,i),h(l,C,i),u(C,V);for(let n=0;n<$.length;n+=1)$[n]&&$[n].m(V,null);u(C,U),u(C,A);for(let n=0;n<p.length;n+=1)p[n]&&p[n].m(A,null);P=!0},p(l,[i]){(!P||i&1)&&d!==(d=l[0].name+"")&&Z(g,d),i&6&&(_=K(l[2]),$=x($,i,J,1,l,_,z,V,Te,ve,null,he)),i&6&&(O=K(l[2]),ee(),p=x(p,i,G,1,l,O,T,A,qe,ge,null,be),te())},i(l){if(!P){for(let i=0;i<O.length;i+=1)H(p[i]);P=!0}},o(l){for(let i=0;i<p.length;i+=1)L(p[i]);P=!1},d(l){l&&(b(t),b(D),b(I),b(j),b(R),b(B),b(E),b(M),b(C));for(let i=0;i<$.length;i+=1)$[i].d();for(let i=0;i<p.length;i+=1)p[i].d()}}}function Oe(s,t,e){let{collection:o}=t,f=204,c=[];const r=a=>e(1,f=a.code);return s.$$set=a=>{"collection"in a&&e(0,o=a.collection)},e(2,c=[{code:204,body:"null"},{code:400,body:`
                {
                  "status": 400,
                  "message": "An error occurred while validating the submitted data.",
                  "data": {
                    "email": {
                      "code": "validation_required",
                      "message": "Missing required value."
                    }
                  }
                }
            `}]),[o,f,c,r]}class Ne extends le{constructor(t){super(),ne(this,t,Oe,Ee,ie,{collection:0})}}function ke(s,t,e){const o=s.slice();return o[5]=t[e],o[7]=e,o}function $e(s,t,e){const o=s.slice();return o[5]=t[e],o[7]=e,o}function we(s){let t,e,o,f,c;function r(){return s[4](s[7])}return{c(){t=m("button"),e=m("div"),e.textContent=`${s[5].title}`,o=y(),v(e,"class","txt"),v(t,"class","tab-item"),F(t,"active",s[1]==s[7])},m(a,d){h(a,t,d),u(t,e),u(t,o),f||(c=oe(t,"click",r),f=!0)},p(a,d){s=a,d&2&&F(t,"active",s[1]==s[7])},d(a){a&&b(t),f=!1,c()}}}function ye(s){let t,e,o,f;var c=s[5].component;function r(a,d){return{props:{collection:a[0]}}}return c&&(e=ue(c,r(s))),{c(){t=m("div"),e&&Y(e.$$.fragment),o=y(),v(t,"class","tab-item"),F(t,"active",s[1]==s[7])},m(a,d){h(a,t,d),e&&X(e,t,null),u(t,o),f=!0},p(a,d){if(c!==(c=a[5].component)){if(e){ee();const g=e;L(g.$$.fragment,1,0,()=>{W(g,1)}),te()}c?(e=ue(c,r(a)),Y(e.$$.fragment),H(e.$$.fragment,1),X(e,t,o)):e=null}else if(c){const g={};d&1&&(g.collection=a[0]),e.$set(g)}(!f||d&2)&&F(t,"active",a[1]==a[7])},i(a){f||(e&&H(e.$$.fragment,a),f=!0)},o(a){e&&L(e.$$.fragment,a),f=!1},d(a){a&&b(t),e&&W(e)}}}function Me(s){var O,G,l,i;let t,e,o=s[0].name+"",f,c,r,a,d,g,q,D=s[0].name+"",I,j,R,B,E,M,C,V,$,z,U,A;B=new Ve({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${s[2]}');

        ...

        await pb.collection('${(O=s[0])==null?void 0:O.name}').requestVerification('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        await pb.collection('${(G=s[0])==null?void 0:G.name}').confirmVerification('VERIFICATION_TOKEN');
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${s[2]}');

        ...

        await pb.collection('${(l=s[0])==null?void 0:l.name}').requestVerification('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        await pb.collection('${(i=s[0])==null?void 0:i.name}').confirmVerification('VERIFICATION_TOKEN');
    `}});let p=K(s[3]),T=[];for(let n=0;n<p.length;n+=1)T[n]=we($e(s,p,n));let P=K(s[3]),_=[];for(let n=0;n<P.length;n+=1)_[n]=ye(ke(s,P,n));const J=n=>L(_[n],1,1,()=>{_[n]=null});return{c(){t=m("h3"),e=N("Account verification ("),f=N(o),c=N(")"),r=y(),a=m("div"),d=m("p"),g=N("Sends "),q=m("strong"),I=N(D),j=N(" account verification request."),R=y(),Y(B.$$.fragment),E=y(),M=m("h6"),M.textContent="API details",C=y(),V=m("div"),$=m("div");for(let n=0;n<T.length;n+=1)T[n].c();z=y(),U=m("div");for(let n=0;n<_.length;n+=1)_[n].c();v(t,"class","m-b-sm"),v(a,"class","content txt-lg m-b-sm"),v(M,"class","m-b-xs"),v($,"class","tabs-header compact"),v(U,"class","tabs-content"),v(V,"class","tabs")},m(n,w){h(n,t,w),u(t,e),u(t,f),u(t,c),h(n,r,w),h(n,a,w),u(a,d),u(d,g),u(d,q),u(q,I),u(d,j),h(n,R,w),X(B,n,w),h(n,E,w),h(n,M,w),h(n,C,w),h(n,V,w),u(V,$);for(let S=0;S<T.length;S+=1)T[S]&&T[S].m($,null);u(V,z),u(V,U);for(let S=0;S<_.length;S+=1)_[S]&&_[S].m(U,null);A=!0},p(n,[w]){var se,ae,ce,re;(!A||w&1)&&o!==(o=n[0].name+"")&&Z(f,o),(!A||w&1)&&D!==(D=n[0].name+"")&&Z(I,D);const S={};if(w&5&&(S.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${n[2]}');

        ...

        await pb.collection('${(se=n[0])==null?void 0:se.name}').requestVerification('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        await pb.collection('${(ae=n[0])==null?void 0:ae.name}').confirmVerification('VERIFICATION_TOKEN');
    `),w&5&&(S.dart=`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${n[2]}');

        ...

        await pb.collection('${(ce=n[0])==null?void 0:ce.name}').requestVerification('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        await pb.collection('${(re=n[0])==null?void 0:re.name}').confirmVerification('VERIFICATION_TOKEN');
    `),B.$set(S),w&10){p=K(n[3]);let k;for(k=0;k<p.length;k+=1){const Q=$e(n,p,k);T[k]?T[k].p(Q,w):(T[k]=we(Q),T[k].c(),T[k].m($,null))}for(;k<T.length;k+=1)T[k].d(1);T.length=p.length}if(w&11){P=K(n[3]);let k;for(k=0;k<P.length;k+=1){const Q=ke(n,P,k);_[k]?(_[k].p(Q,w),H(_[k],1)):(_[k]=ye(Q),_[k].c(),H(_[k],1),_[k].m(U,null))}for(ee(),k=P.length;k<_.length;k+=1)J(k);te()}},i(n){if(!A){H(B.$$.fragment,n);for(let w=0;w<P.length;w+=1)H(_[w]);A=!0}},o(n){L(B.$$.fragment,n),_=_.filter(Boolean);for(let w=0;w<_.length;w+=1)L(_[w]);A=!1},d(n){n&&(b(t),b(r),b(a),b(R),b(E),b(M),b(C),b(V)),W(B,n),fe(T,n),fe(_,n)}}}function Se(s,t,e){let o,{collection:f}=t;const c=[{title:"Request verification",component:Ne},{title:"Confirm verification",component:Be}];let r=0;const a=d=>e(1,r=d);return s.$$set=d=>{"collection"in d&&e(0,f=d.collection)},e(2,o=Pe.getApiExampleUrl(Ae.baseURL)),[f,r,o,c,a]}class Ke extends le{constructor(t){super(),ne(this,t,Se,Me,ie,{collection:0})}}export{Ke as default};
