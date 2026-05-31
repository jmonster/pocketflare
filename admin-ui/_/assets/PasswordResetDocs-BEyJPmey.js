import{d as se,E as ne,U as ae,z as U,w as h,a3 as J,a2 as G,V as Z,a4 as ee,t as ye,D as te,N as Te,l as le,G as v,i as u,x as p,Z as S,_ as D,j as g,a0 as j,J as oe,a as Ee,u as X,K as Y,s as x,S as qe,v as fe,b as Ce,P as Oe,q as pe}from"./index-B4OIv7rD.js";function me(a,t,e){const n=a.slice();return n[4]=t[e],n}function _e(a,t,e){const n=a.slice();return n[4]=t[e],n}function be(a,t){let e,n=t[4].code+"",d,c,r,o;function f(){return t[3](t[4])}return{key:a,first:null,c(){e=p("button"),d=D(n),c=S(),g(e,"class","tab-item"),j(e,"active",t[1]===t[4].code),this.first=e},m(k,y){v(k,e,y),u(e,d),u(e,c),r||(o=oe(e,"click",f),r=!0)},p(k,y){t=k,y&4&&n!==(n=t[4].code+"")&&Z(d,n),y&6&&j(e,"active",t[1]===t[4].code)},d(k){k&&h(e),r=!1,o()}}}function he(a,t){let e,n,d,c;return n=new Ee({props:{content:t[4].body}}),{key:a,first:null,c(){e=p("div"),x(n.$$.fragment),d=S(),g(e,"class","tab-item"),j(e,"active",t[1]===t[4].code),this.first=e},m(r,o){v(r,e,o),Y(n,e,null),u(e,d),c=!0},p(r,o){t=r;const f={};o&4&&(f.content=t[4].body),n.$set(f),(!c||o&6)&&j(e,"active",t[1]===t[4].code)},i(r){c||(G(n.$$.fragment,r),c=!0)},o(r){J(n.$$.fragment,r),c=!1},d(r){r&&h(e),X(n)}}}function Ne(a){let t,e,n,d,c,r,o,f=a[0].name+"",k,y,K,C,z,A,H,O,N,T,q,R=[],M=new Map,L,W,b=[],F=new Map,E,P=U(a[2]);const B=l=>l[4].code;for(let l=0;l<P.length;l+=1){let s=_e(a,P,l),_=B(s);M.set(_,R[l]=be(_,s))}let m=U(a[2]);const V=l=>l[4].code;for(let l=0;l<m.length;l+=1){let s=me(a,m,l),_=V(s);F.set(_,b[l]=he(_,s))}return{c(){t=p("div"),e=p("strong"),e.textContent="POST",n=S(),d=p("div"),c=p("p"),r=D("/api/collections/"),o=p("strong"),k=D(f),y=D("/confirm-password-reset"),K=S(),C=p("div"),C.textContent="Body Parameters",z=S(),A=p("table"),A.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr></thead> <tbody><tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>token</span></div></td> <td><span class="label">String</span></td> <td>The token from the password reset request email.</td></tr> <tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>password</span></div></td> <td><span class="label">String</span></td> <td>The new password to set.</td></tr> <tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>passwordConfirm</span></div></td> <td><span class="label">String</span></td> <td>The new password confirmation.</td></tr></tbody>',H=S(),O=p("div"),O.textContent="Responses",N=S(),T=p("div"),q=p("div");for(let l=0;l<R.length;l+=1)R[l].c();L=S(),W=p("div");for(let l=0;l<b.length;l+=1)b[l].c();g(e,"class","label label-primary"),g(d,"class","content"),g(t,"class","alert alert-success"),g(C,"class","section-title"),g(A,"class","table-compact table-border m-b-base"),g(O,"class","section-title"),g(q,"class","tabs-header compact combined left"),g(W,"class","tabs-content"),g(T,"class","tabs")},m(l,s){v(l,t,s),u(t,e),u(t,n),u(t,d),u(d,c),u(c,r),u(c,o),u(o,k),u(c,y),v(l,K,s),v(l,C,s),v(l,z,s),v(l,A,s),v(l,H,s),v(l,O,s),v(l,N,s),v(l,T,s),u(T,q);for(let _=0;_<R.length;_+=1)R[_]&&R[_].m(q,null);u(T,L),u(T,W);for(let _=0;_<b.length;_+=1)b[_]&&b[_].m(W,null);E=!0},p(l,[s]){(!E||s&1)&&f!==(f=l[0].name+"")&&Z(k,f),s&6&&(P=U(l[2]),R=ee(R,s,B,1,l,P,M,q,ye,be,null,_e)),s&6&&(m=U(l[2]),te(),b=ee(b,s,V,1,l,m,F,W,Te,he,null,me),le())},i(l){if(!E){for(let s=0;s<m.length;s+=1)G(b[s]);E=!0}},o(l){for(let s=0;s<b.length;s+=1)J(b[s]);E=!1},d(l){l&&(h(t),h(K),h(C),h(z),h(A),h(H),h(O),h(N),h(T));for(let s=0;s<R.length;s+=1)R[s].d();for(let s=0;s<b.length;s+=1)b[s].d()}}}function Ae(a,t,e){let{collection:n}=t,d=204,c=[];const r=o=>e(1,d=o.code);return a.$$set=o=>{"collection"in o&&e(0,n=o.collection)},e(2,c=[{code:204,body:"null"},{code:400,body:`
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
            `}]),[n,d,c,r]}class We extends se{constructor(t){super(),ne(this,t,Ae,Ne,ae,{collection:0})}}function ve(a,t,e){const n=a.slice();return n[4]=t[e],n}function ge(a,t,e){const n=a.slice();return n[4]=t[e],n}function ke(a,t){let e,n=t[4].code+"",d,c,r,o;function f(){return t[3](t[4])}return{key:a,first:null,c(){e=p("button"),d=D(n),c=S(),g(e,"class","tab-item"),j(e,"active",t[1]===t[4].code),this.first=e},m(k,y){v(k,e,y),u(e,d),u(e,c),r||(o=oe(e,"click",f),r=!0)},p(k,y){t=k,y&4&&n!==(n=t[4].code+"")&&Z(d,n),y&6&&j(e,"active",t[1]===t[4].code)},d(k){k&&h(e),r=!1,o()}}}function we(a,t){let e,n,d,c;return n=new Ee({props:{content:t[4].body}}),{key:a,first:null,c(){e=p("div"),x(n.$$.fragment),d=S(),g(e,"class","tab-item"),j(e,"active",t[1]===t[4].code),this.first=e},m(r,o){v(r,e,o),Y(n,e,null),u(e,d),c=!0},p(r,o){t=r;const f={};o&4&&(f.content=t[4].body),n.$set(f),(!c||o&6)&&j(e,"active",t[1]===t[4].code)},i(r){c||(G(n.$$.fragment,r),c=!0)},o(r){J(n.$$.fragment,r),c=!1},d(r){r&&h(e),X(n)}}}function De(a){let t,e,n,d,c,r,o,f=a[0].name+"",k,y,K,C,z,A,H,O,N,T,q,R=[],M=new Map,L,W,b=[],F=new Map,E,P=U(a[2]);const B=l=>l[4].code;for(let l=0;l<P.length;l+=1){let s=ge(a,P,l),_=B(s);M.set(_,R[l]=ke(_,s))}let m=U(a[2]);const V=l=>l[4].code;for(let l=0;l<m.length;l+=1){let s=ve(a,m,l),_=V(s);F.set(_,b[l]=we(_,s))}return{c(){t=p("div"),e=p("strong"),e.textContent="POST",n=S(),d=p("div"),c=p("p"),r=D("/api/collections/"),o=p("strong"),k=D(f),y=D("/request-password-reset"),K=S(),C=p("div"),C.textContent="Body Parameters",z=S(),A=p("table"),A.innerHTML='<thead><tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr></thead> <tbody><tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>email</span></div></td> <td><span class="label">String</span></td> <td>The auth record email address to send the password reset request (if exists).</td></tr></tbody>',H=S(),O=p("div"),O.textContent="Responses",N=S(),T=p("div"),q=p("div");for(let l=0;l<R.length;l+=1)R[l].c();L=S(),W=p("div");for(let l=0;l<b.length;l+=1)b[l].c();g(e,"class","label label-primary"),g(d,"class","content"),g(t,"class","alert alert-success"),g(C,"class","section-title"),g(A,"class","table-compact table-border m-b-base"),g(O,"class","section-title"),g(q,"class","tabs-header compact combined left"),g(W,"class","tabs-content"),g(T,"class","tabs")},m(l,s){v(l,t,s),u(t,e),u(t,n),u(t,d),u(d,c),u(c,r),u(c,o),u(o,k),u(c,y),v(l,K,s),v(l,C,s),v(l,z,s),v(l,A,s),v(l,H,s),v(l,O,s),v(l,N,s),v(l,T,s),u(T,q);for(let _=0;_<R.length;_+=1)R[_]&&R[_].m(q,null);u(T,L),u(T,W);for(let _=0;_<b.length;_+=1)b[_]&&b[_].m(W,null);E=!0},p(l,[s]){(!E||s&1)&&f!==(f=l[0].name+"")&&Z(k,f),s&6&&(P=U(l[2]),R=ee(R,s,B,1,l,P,M,q,ye,ke,null,ge)),s&6&&(m=U(l[2]),te(),b=ee(b,s,V,1,l,m,F,W,Te,we,null,ve),le())},i(l){if(!E){for(let s=0;s<m.length;s+=1)G(b[s]);E=!0}},o(l){for(let s=0;s<b.length;s+=1)J(b[s]);E=!1},d(l){l&&(h(t),h(K),h(C),h(z),h(A),h(H),h(O),h(N),h(T));for(let s=0;s<R.length;s+=1)R[s].d();for(let s=0;s<b.length;s+=1)b[s].d()}}}function Me(a,t,e){let{collection:n}=t,d=204,c=[];const r=o=>e(1,d=o.code);return a.$$set=o=>{"collection"in o&&e(0,n=o.collection)},e(2,c=[{code:204,body:"null"},{code:400,body:`
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
            `}]),[n,d,c,r]}class Be extends se{constructor(t){super(),ne(this,t,Me,De,ae,{collection:0})}}function $e(a,t,e){const n=a.slice();return n[5]=t[e],n[7]=e,n}function Re(a,t,e){const n=a.slice();return n[5]=t[e],n[7]=e,n}function Pe(a){let t,e,n,d,c;function r(){return a[4](a[7])}return{c(){t=p("button"),e=p("div"),e.textContent=`${a[5].title}`,n=S(),g(e,"class","txt"),g(t,"class","tab-item"),j(t,"active",a[1]==a[7])},m(o,f){v(o,t,f),u(t,e),u(t,n),d||(c=oe(t,"click",r),d=!0)},p(o,f){a=o,f&2&&j(t,"active",a[1]==a[7])},d(o){o&&h(t),d=!1,c()}}}function Se(a){let t,e,n,d;var c=a[5].component;function r(o,f){return{props:{collection:o[0]}}}return c&&(e=pe(c,r(a))),{c(){t=p("div"),e&&x(e.$$.fragment),n=S(),g(t,"class","tab-item"),j(t,"active",a[1]==a[7])},m(o,f){v(o,t,f),e&&Y(e,t,null),u(t,n),d=!0},p(o,f){if(c!==(c=o[5].component)){if(e){te();const k=e;J(k.$$.fragment,1,0,()=>{X(k,1)}),le()}c?(e=pe(c,r(o)),x(e.$$.fragment),G(e.$$.fragment,1),Y(e,t,n)):e=null}else if(c){const k={};f&1&&(k.collection=o[0]),e.$set(k)}(!d||f&2)&&j(t,"active",o[1]==o[7])},i(o){d||(e&&G(e.$$.fragment,o),d=!0)},o(o){e&&J(e.$$.fragment,o),d=!1},d(o){o&&h(t),e&&X(e)}}}function Ie(a){var l,s,_,ie;let t,e,n=a[0].name+"",d,c,r,o,f,k,y,K=a[0].name+"",C,z,A,H,O,N,T,q,R,M,L,W,b,F;N=new qe({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${a[2]}');

        ...

        await pb.collection('${(l=a[0])==null?void 0:l.name}').requestPasswordReset('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(s=a[0])==null?void 0:s.name}').confirmPasswordReset(
            'RESET_TOKEN',
            'NEW_PASSWORD',
            'NEW_PASSWORD_CONFIRM',
        );
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${a[2]}');

        ...

        await pb.collection('${(_=a[0])==null?void 0:_.name}').requestPasswordReset('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(ie=a[0])==null?void 0:ie.name}').confirmPasswordReset(
          'RESET_TOKEN',
          'NEW_PASSWORD',
          'NEW_PASSWORD_CONFIRM',
        );
    `}});let E=U(a[3]),P=[];for(let i=0;i<E.length;i+=1)P[i]=Pe(Re(a,E,i));let B=U(a[3]),m=[];for(let i=0;i<B.length;i+=1)m[i]=Se($e(a,B,i));const V=i=>J(m[i],1,1,()=>{m[i]=null});return{c(){t=p("h3"),e=D("Password reset ("),d=D(n),c=D(")"),r=S(),o=p("div"),f=p("p"),k=D("Sends "),y=p("strong"),C=D(K),z=D(" password reset email request."),A=S(),H=p("p"),H.textContent=`On successful password reset all previously issued auth tokens for the specific record will be
        automatically invalidated.`,O=S(),x(N.$$.fragment),T=S(),q=p("h6"),q.textContent="API details",R=S(),M=p("div"),L=p("div");for(let i=0;i<P.length;i+=1)P[i].c();W=S(),b=p("div");for(let i=0;i<m.length;i+=1)m[i].c();g(t,"class","m-b-sm"),g(o,"class","content txt-lg m-b-sm"),g(q,"class","m-b-xs"),g(L,"class","tabs-header compact"),g(b,"class","tabs-content"),g(M,"class","tabs")},m(i,$){v(i,t,$),u(t,e),u(t,d),u(t,c),v(i,r,$),v(i,o,$),u(o,f),u(f,k),u(f,y),u(y,C),u(f,z),u(o,A),u(o,H),v(i,O,$),Y(N,i,$),v(i,T,$),v(i,q,$),v(i,R,$),v(i,M,$),u(M,L);for(let I=0;I<P.length;I+=1)P[I]&&P[I].m(L,null);u(M,W),u(M,b);for(let I=0;I<m.length;I+=1)m[I]&&m[I].m(b,null);F=!0},p(i,[$]){var ce,re,de,ue;(!F||$&1)&&n!==(n=i[0].name+"")&&Z(d,n),(!F||$&1)&&K!==(K=i[0].name+"")&&Z(C,K);const I={};if($&5&&(I.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${i[2]}');

        ...

        await pb.collection('${(ce=i[0])==null?void 0:ce.name}').requestPasswordReset('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(re=i[0])==null?void 0:re.name}').confirmPasswordReset(
            'RESET_TOKEN',
            'NEW_PASSWORD',
            'NEW_PASSWORD_CONFIRM',
        );
    `),$&5&&(I.dart=`
        import 'package:pocketbase/pocketbase.dart';

        final pb = PocketBase('${i[2]}');

        ...

        await pb.collection('${(de=i[0])==null?void 0:de.name}').requestPasswordReset('test@example.com');

        // ---
        // (optional) in your custom confirmation page:
        // ---

        // note: after this call all previously issued auth tokens are invalidated
        await pb.collection('${(ue=i[0])==null?void 0:ue.name}').confirmPasswordReset(
          'RESET_TOKEN',
          'NEW_PASSWORD',
          'NEW_PASSWORD_CONFIRM',
        );
    `),N.$set(I),$&10){E=U(i[3]);let w;for(w=0;w<E.length;w+=1){const Q=Re(i,E,w);P[w]?P[w].p(Q,$):(P[w]=Pe(Q),P[w].c(),P[w].m(L,null))}for(;w<P.length;w+=1)P[w].d(1);P.length=E.length}if($&11){B=U(i[3]);let w;for(w=0;w<B.length;w+=1){const Q=$e(i,B,w);m[w]?(m[w].p(Q,$),G(m[w],1)):(m[w]=Se(Q),m[w].c(),G(m[w],1),m[w].m(b,null))}for(te(),w=B.length;w<m.length;w+=1)V(w);le()}},i(i){if(!F){G(N.$$.fragment,i);for(let $=0;$<B.length;$+=1)G(m[$]);F=!0}},o(i){J(N.$$.fragment,i),m=m.filter(Boolean);for(let $=0;$<m.length;$+=1)J(m[$]);F=!1},d(i){i&&(h(t),h(r),h(o),h(O),h(T),h(q),h(R),h(M)),X(N,i),fe(P,i),fe(m,i)}}}function Ke(a,t,e){let n,{collection:d}=t;const c=[{title:"Request password reset",component:Be},{title:"Confirm password reset",component:We}];let r=0;const o=f=>e(1,r=f);return a.$$set=f=>{"collection"in f&&e(0,d=f.collection)},e(2,n=Ce.getApiExampleUrl(Oe.baseURL)),[d,r,n,c,o]}class Ue extends se{constructor(t){super(),ne(this,t,Ke,Ie,ae,{collection:0})}}export{Ue as default};
