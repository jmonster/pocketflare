import{d as se,E as oe,U as ie,z as G,w as g,a3 as Z,a2 as V,V as Q,a4 as le,t as Re,D as ne,N as Se,l as ae,G as v,i as u,x as p,Z as C,_ as W,j as b,a0 as I,J as ce,a as Oe,u as x,K as ee,s as te,S as Me,v as _e,b as Be,P as De,q as be}from"./index-DiFYKP__.js";function ge(n,e,t){const l=n.slice();return l[4]=e[t],l}function ve(n,e,t){const l=n.slice();return l[4]=e[t],l}function ke(n,e){let t,l=e[4].code+"",d,i,r,a;function m(){return e[3](e[4])}return{key:n,first:null,c(){t=p("button"),d=W(l),i=C(),b(t,"class","tab-item"),I(t,"active",e[1]===e[4].code),this.first=t},m(k,T){v(k,t,T),u(t,d),u(t,i),r||(a=ce(t,"click",m),r=!0)},p(k,T){e=k,T&4&&l!==(l=e[4].code+"")&&Q(d,l),T&6&&I(t,"active",e[1]===e[4].code)},d(k){k&&g(t),r=!1,a()}}}function $e(n,e){let t,l,d,i;return l=new Oe({props:{content:e[4].body}}),{key:n,first:null,c(){t=p("div"),te(l.$$.fragment),d=C(),b(t,"class","tab-item"),I(t,"active",e[1]===e[4].code),this.first=t},m(r,a){v(r,t,a),ee(l,t,null),u(t,d),i=!0},p(r,a){e=r;const m={};a&4&&(m.content=e[4].body),l.$set(m),(!i||a&6)&&I(t,"active",e[1]===e[4].code)},i(r){i||(V(l.$$.fragment,r),i=!0)},o(r){Z(l.$$.fragment,r),i=!1},d(r){r&&g(t),x(l)}}}function Ne(n){let e,t,l,d,i,r,a,m=n[0].name+"",k,T,z,L,J,U,Y,B,D,S,N,q=[],O=new Map,A,j,P=[],H=new Map,w,E=G(n[2]);const M=c=>c[4].code;for(let c=0;c<E.length;c+=1){let f=ve(n,E,c),s=M(f);O.set(s,q[c]=ke(s,f))}let _=G(n[2]);const F=c=>c[4].code;for(let c=0;c<_.length;c+=1){let f=ge(n,_,c),s=F(f);H.set(s,P[c]=$e(s,f))}return{c(){e=p("div"),t=p("strong"),t.textContent="POST",l=C(),d=p("div"),i=p("p"),r=W("/api/collections/"),a=p("strong"),k=W(m),T=W("/confirm-email-change"),z=C(),L=p("div"),L.textContent="Body Parameters",J=C(),U=p("table"),U.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr></thead> <tbody><tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>token</span></div></td> <td><span class="label">String</span></td> <td>The token from the change email request email.</td></tr> <tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>password</span></div></td> <td><span class="label">String</span></td> <td>The account password to confirm the email change.</td></tr></tbody>',Y=C(),B=p("div"),B.textContent="Responses",D=C(),S=p("div"),N=p("div");for(let c=0;c<q.length;c+=1)q[c].c();A=C(),j=p("div");for(let c=0;c<P.length;c+=1)P[c].c();b(t,"class","label label-primary"),b(d,"class","content"),b(e,"class","alert alert-success"),b(L,"class","section-title"),b(U,"class","table-compact table-border m-b-base"),b(B,"class","section-title"),b(N,"class","tabs-header compact combined left"),b(j,"class","tabs-content"),b(S,"class","tabs")},m(c,f){v(c,e,f),u(e,t),u(e,l),u(e,d),u(d,i),u(i,r),u(i,a),u(a,k),u(i,T),v(c,z,f),v(c,L,f),v(c,J,f),v(c,U,f),v(c,Y,f),v(c,B,f),v(c,D,f),v(c,S,f),u(S,N);for(let s=0;s<q.length;s+=1)q[s]&&q[s].m(N,null);u(S,A),u(S,j);for(let s=0;s<P.length;s+=1)P[s]&&P[s].m(j,null);w=!0},p(c,[f]){(!w||f&1)&&m!==(m=c[0].name+"")&&Q(k,m),f&6&&(E=G(c[2]),q=le(q,f,M,1,c,E,O,N,Re,ke,null,ve)),f&6&&(_=G(c[2]),ne(),P=le(P,f,F,1,c,_,H,j,Se,$e,null,ge),ae())},i(c){if(!w){for(let f=0;f<_.length;f+=1)V(P[f]);w=!0}},o(c){for(let f=0;f<P.length;f+=1)Z(P[f]);w=!1},d(c){c&&(g(e),g(z),g(L),g(J),g(U),g(Y),g(B),g(D),g(S));for(let f=0;f<q.length;f+=1)q[f].d();for(let f=0;f<P.length;f+=1)P[f].d()}}}function He(n,e,t){let{collection:l}=e,d=204,i=[];const r=a=>t(1,d=a.code);return n.$$set=a=>{"collection"in a&&t(0,l=a.collection)},t(2,i=[{code:204,body:"null"},{code:400,body:`
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
            `}]),[l,d,i,r]}class Le extends se{constructor(e){super(),oe(this,e,He,Ne,ie,{collection:0})}}function we(n,e,t){const l=n.slice();return l[4]=e[t],l}function ye(n,e,t){const l=n.slice();return l[4]=e[t],l}function Ce(n,e){let t,l=e[4].code+"",d,i,r,a;function m(){return e[3](e[4])}return{key:n,first:null,c(){t=p("button"),d=W(l),i=C(),b(t,"class","tab-item"),I(t,"active",e[1]===e[4].code),this.first=t},m(k,T){v(k,t,T),u(t,d),u(t,i),r||(a=ce(t,"click",m),r=!0)},p(k,T){e=k,T&4&&l!==(l=e[4].code+"")&&Q(d,l),T&6&&I(t,"active",e[1]===e[4].code)},d(k){k&&g(t),r=!1,a()}}}function Ee(n,e){let t,l,d,i;return l=new Oe({props:{content:e[4].body}}),{key:n,first:null,c(){t=p("div"),te(l.$$.fragment),d=C(),b(t,"class","tab-item"),I(t,"active",e[1]===e[4].code),this.first=t},m(r,a){v(r,t,a),ee(l,t,null),u(t,d),i=!0},p(r,a){e=r;const m={};a&4&&(m.content=e[4].body),l.$set(m),(!i||a&6)&&I(t,"active",e[1]===e[4].code)},i(r){i||(V(l.$$.fragment,r),i=!0)},o(r){Z(l.$$.fragment,r),i=!1},d(r){r&&g(t),x(l)}}}function Ue(n){let e,t,l,d,i,r,a,m=n[0].name+"",k,T,z,L,J,U,Y,B,D,S,N,q,O,A=[],j=new Map,P,H,w=[],E=new Map,M,_=G(n[2]);const F=s=>s[4].code;for(let s=0;s<_.length;s+=1){let h=ye(n,_,s),R=F(h);j.set(R,A[s]=Ce(R,h))}let c=G(n[2]);const f=s=>s[4].code;for(let s=0;s<c.length;s+=1){let h=we(n,c,s),R=f(h);E.set(R,w[s]=Ee(R,h))}return{c(){e=p("div"),t=p("strong"),t.textContent="POST",l=C(),d=p("div"),i=p("p"),r=W("/api/collections/"),a=p("strong"),k=W(m),T=W("/request-email-change"),z=C(),L=p("p"),L.innerHTML="Requires <code>Authorization:TOKEN</code>",J=C(),U=p("div"),U.textContent="Body Parameters",Y=C(),B=p("table"),B.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr></thead> <tbody><tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>newEmail</span></div></td> <td><span class="label">String</span></td> <td>The new email address to send the change email request.</td></tr></tbody>',D=C(),S=p("div"),S.textContent="Responses",N=C(),q=p("div"),O=p("div");for(let s=0;s<A.length;s+=1)A[s].c();P=C(),H=p("div");for(let s=0;s<w.length;s+=1)w[s].c();b(t,"class","label label-primary"),b(d,"class","content"),b(L,"class","txt-hint txt-sm txt-right"),b(e,"class","alert alert-success"),b(U,"class","section-title"),b(B,"class","table-compact table-border m-b-base"),b(S,"class","section-title"),b(O,"class","tabs-header compact combined left"),b(H,"class","tabs-content"),b(q,"class","tabs")},m(s,h){v(s,e,h),u(e,t),u(e,l),u(e,d),u(d,i),u(i,r),u(i,a),u(a,k),u(i,T),u(e,z),u(e,L),v(s,J,h),v(s,U,h),v(s,Y,h),v(s,B,h),v(s,D,h),v(s,S,h),v(s,N,h),v(s,q,h),u(q,O);for(let R=0;R<A.length;R+=1)A[R]&&A[R].m(O,null);u(q,P),u(q,H);for(let R=0;R<w.length;R+=1)w[R]&&w[R].m(H,null);M=!0},p(s,[h]){(!M||h&1)&&m!==(m=s[0].name+"")&&Q(k,m),h&6&&(_=G(s[2]),A=le(A,h,F,1,s,_,j,O,Re,Ce,null,ye)),h&6&&(c=G(s[2]),ne(),w=le(w,h,f,1,s,c,E,H,Se,Ee,null,we),ae())},i(s){if(!M){for(let h=0;h<c.length;h+=1)V(w[h]);M=!0}},o(s){for(let h=0;h<w.length;h+=1)Z(w[h]);M=!1},d(s){s&&(g(e),g(J),g(U),g(Y),g(B),g(D),g(S),g(N),g(q));for(let h=0;h<A.length;h+=1)A[h].d();for(let h=0;h<w.length;h+=1)w[h].d()}}}function We(n,e,t){let{collection:l}=e,d=204,i=[];const r=a=>t(1,d=a.code);return n.$$set=a=>{"collection"in a&&t(0,l=a.collection)},t(2,i=[{code:204,body:"null"},{code:400,body:`
                {
                  "status": 400,
                  "message": "An error occurred while validating the submitted data.",
                  "data": {
                    "newEmail": {
                      "code": "validation_required",
                      "message": "Missing required value."
                    }
                  }
                }
            `},{code:401,body:`
                {
                  "status": 401,
                  "message": "The request requires valid record authorization token to be set.",
                  "data": {}
                }
            `},{code:403,body:`
                {
                  "status": 403,
                  "message": "The authorized record model is not allowed to perform this action.",
                  "data": {}
                }
            `}]),[l,d,i,r]}class Ke extends se{constructor(e){super(),oe(this,e,We,Ue,ie,{collection:0})}}function qe(n,e,t){const l=n.slice();return l[5]=e[t],l[7]=t,l}function Pe(n,e,t){const l=n.slice();return l[5]=e[t],l[7]=t,l}function Te(n){let e,t,l,d,i;function r(){return n[4](n[7])}return{c(){e=p("button"),t=p("div"),t.textContent=`${n[5].title}`,l=C(),b(t,"class","txt"),b(e,"class","tab-item"),I(e,"active",n[1]==n[7])},m(a,m){v(a,e,m),u(e,t),u(e,l),d||(i=ce(e,"click",r),d=!0)},p(a,m){n=a,m&2&&I(e,"active",n[1]==n[7])},d(a){a&&g(e),d=!1,i()}}}function Ae(n){let e,t,l,d;var i=n[5].component;function r(a,m){return{props:{collection:a[0]}}}return i&&(t=be(i,r(n))),{c(){e=p("div"),t&&te(t.$$.fragment),l=C(),b(e,"class","tab-item"),I(e,"active",n[1]==n[7])},m(a,m){v(a,e,m),t&&ee(t,e,null),u(e,l),d=!0},p(a,m){if(i!==(i=a[5].component)){if(t){ne();const k=t;Z(k.$$.fragment,1,0,()=>{x(k,1)}),ae()}i?(t=be(i,r(a)),te(t.$$.fragment),V(t.$$.fragment,1),ee(t,e,l)):t=null}else if(i){const k={};m&1&&(k.collection=a[0]),t.$set(k)}(!d||m&2)&&I(e,"active",a[1]==a[7])},i(a){d||(t&&V(t.$$.fragment,a),d=!0)},o(a){t&&Z(t.$$.fragment,a),d=!1},d(a){a&&g(e),t&&x(t)}}}function Ge(n){var c,f,s,h,R,re;let e,t,l=n[0].name+"",d,i,r,a,m,k,T,z=n[0].name+"",L,J,U,Y,B,D,S,N,q,O,A,j,P,H;D=new Me({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${n[2]}');

        ...

        await pb.collection('${(c=n[0])==null?void 0:c.name}').authWithPassword('test@example.com', '1234567890');

        await pb.collection('${(f=n[0])==null?void 0:f.name}').requestEmailChange('new@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(s=n[0])==null?void 0:s.name}').confirmEmailChange(
            'EMAIL_CHANGE_TOKEN',
            'YOUR_PASSWORD',
        );
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${n[2]}');

        ...

        await pb.collection('${(h=n[0])==null?void 0:h.name}').authWithPassword('test@example.com', '1234567890');

        await pb.collection('${(R=n[0])==null?void 0:R.name}').requestEmailChange('new@example.com');

        ...

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(re=n[0])==null?void 0:re.name}').confirmEmailChange(
          'EMAIL_CHANGE_TOKEN',
          'YOUR_PASSWORD',
        );
    `}});let w=G(n[3]),E=[];for(let o=0;o<w.length;o+=1)E[o]=Te(Pe(n,w,o));let M=G(n[3]),_=[];for(let o=0;o<M.length;o+=1)_[o]=Ae(qe(n,M,o));const F=o=>Z(_[o],1,1,()=>{_[o]=null});return{c(){e=p("h3"),t=W("Email change ("),d=W(l),i=W(")"),r=C(),a=p("div"),m=p("p"),k=W("Sends "),T=p("strong"),L=W(z),J=W(" email change request."),U=C(),Y=p("p"),Y.textContent=`On successful email change all previously issued auth tokens for the specific record will be
        automatically invalidated.`,B=C(),te(D.$$.fragment),S=C(),N=p("h6"),N.textContent="API details",q=C(),O=p("div"),A=p("div");for(let o=0;o<E.length;o+=1)E[o].c();j=C(),P=p("div");for(let o=0;o<_.length;o+=1)_[o].c();b(e,"class","m-b-sm"),b(a,"class","content txt-lg m-b-sm"),b(N,"class","m-b-xs"),b(A,"class","tabs-header compact"),b(P,"class","tabs-content"),b(O,"class","tabs")},m(o,y){v(o,e,y),u(e,t),u(e,d),u(e,i),v(o,r,y),v(o,a,y),u(a,m),u(m,k),u(m,T),u(T,L),u(m,J),u(a,U),u(a,Y),v(o,B,y),ee(D,o,y),v(o,S,y),v(o,N,y),v(o,q,y),v(o,O,y),u(O,A);for(let K=0;K<E.length;K+=1)E[K]&&E[K].m(A,null);u(O,j),u(O,P);for(let K=0;K<_.length;K+=1)_[K]&&_[K].m(P,null);H=!0},p(o,[y]){var de,ue,fe,me,he,pe;(!H||y&1)&&l!==(l=o[0].name+"")&&Q(d,l),(!H||y&1)&&z!==(z=o[0].name+"")&&Q(L,z);const K={};if(y&5&&(K.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${o[2]}');

        ...

        await pb.collection('${(de=o[0])==null?void 0:de.name}').authWithPassword('test@example.com', '1234567890');

        await pb.collection('${(ue=o[0])==null?void 0:ue.name}').requestEmailChange('new@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(fe=o[0])==null?void 0:fe.name}').confirmEmailChange(
            'EMAIL_CHANGE_TOKEN',
            'YOUR_PASSWORD',
        );
    `),y&5&&(K.dart=`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${o[2]}');

        ...

        await pb.collection('${(me=o[0])==null?void 0:me.name}').authWithPassword('test@example.com', '1234567890');

        await pb.collection('${(he=o[0])==null?void 0:he.name}').requestEmailChange('new@example.com');

        ...

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(pe=o[0])==null?void 0:pe.name}').confirmEmailChange(
          'EMAIL_CHANGE_TOKEN',
          'YOUR_PASSWORD',
        );
    `),D.$set(K),y&10){w=G(o[3]);let $;for($=0;$<w.length;$+=1){const X=Pe(o,w,$);E[$]?E[$].p(X,y):(E[$]=Te(X),E[$].c(),E[$].m(A,null))}for(;$<E.length;$+=1)E[$].d(1);E.length=w.length}if(y&11){M=G(o[3]);let $;for($=0;$<M.length;$+=1){const X=qe(o,M,$);_[$]?(_[$].p(X,y),V(_[$],1)):(_[$]=Ae(X),_[$].c(),V(_[$],1),_[$].m(P,null))}for(ne(),$=M.length;$<_.length;$+=1)F($);ae()}},i(o){if(!H){V(D.$$.fragment,o);for(let y=0;y<M.length;y+=1)V(_[y]);H=!0}},o(o){Z(D.$$.fragment,o),_=_.filter(Boolean);for(let y=0;y<_.length;y+=1)Z(_[y]);H=!1},d(o){o&&(g(e),g(r),g(a),g(B),g(S),g(N),g(q),g(O)),x(D,o),_e(E,o),_e(_,o)}}}function Ie(n,e,t){let l,{collection:d}=e;const i=[{title:"Request email change",component:Ke},{title:"Confirm email change",component:Le}];let r=0;const a=m=>t(1,r=m);return n.$$set=m=>{"collection"in m&&t(0,d=m.collection)},t(2,l=Be.getApiExampleUrl(De.baseURL)),[d,r,l,i,a]}class Ye extends se{constructor(e){super(),oe(this,e,Ie,Ge,ie,{collection:0})}}export{Ye as default};
