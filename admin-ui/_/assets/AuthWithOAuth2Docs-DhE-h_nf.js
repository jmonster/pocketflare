import{d as xe,E as Ee,U as Je,S as Ne,a as Ve,z as K,w as r,u as Q,a3 as V,a2 as x,V as pe,a4 as We,t as ze,D as Ke,N as Qe,l as Ze,G as c,i as a,K as Z,x as o,_,Z as h,s as G,j as p,b as Be,P as Ge,a0 as I,J as Ie}from"./index-DiFYKP__.js";import{F as Xe}from"./FieldsQueryParam-Dol1zKfT.js";function Fe(s,l,n){const i=s.slice();return i[5]=l[n],i}function Le(s,l,n){const i=s.slice();return i[5]=l[n],i}function je(s,l){let n,i=l[5].code+"",f,g,d,b;function k(){return l[4](l[5])}return{key:s,first:null,c(){n=o("button"),f=_(i),g=h(),p(n,"class","tab-item"),I(n,"active",l[1]===l[5].code),this.first=n},m(v,O){c(v,n,O),a(n,f),a(n,g),d||(b=Ie(n,"click",k),d=!0)},p(v,O){l=v,O&4&&i!==(i=l[5].code+"")&&pe(f,i),O&6&&I(n,"active",l[1]===l[5].code)},d(v){v&&r(n),d=!1,b()}}}function He(s,l){let n,i,f,g;return i=new Ve({props:{content:l[5].body}}),{key:s,first:null,c(){n=o("div"),G(i.$$.fragment),f=h(),p(n,"class","tab-item"),I(n,"active",l[1]===l[5].code),this.first=n},m(d,b){c(d,n,b),Z(i,n,null),a(n,f),g=!0},p(d,b){l=d;const k={};b&4&&(k.content=l[5].body),i.$set(k),(!g||b&6)&&I(n,"active",l[1]===l[5].code)},i(d){g||(x(i.$$.fragment,d),g=!0)},o(d){V(i.$$.fragment,d),g=!1},d(d){d&&r(n),Q(i)}}}function Ye(s){let l,n,i=s[0].name+"",f,g,d,b,k,v,O,R,X,y,E,be,J,P,me,Y,N=s[0].name+"",ee,fe,te,M,ae,U,le,W,ne,A,oe,ge,B,S,se,_e,ie,ke,m,ve,C,we,$e,Oe,re,ye,ce,Ae,Se,Te,de,Ce,qe,q,ue,F,he,T,L,$=[],De=new Map,Re,j,w=[],Pe=new Map,D;v=new Ne({props:{js:`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${s[3]}');

        ...

        // OAuth2 authentication with a single realtime call.
        //
        // Make sure to register ${s[3]}/api/oauth2-redirect as redirect url.
        const authData = await pb.collection('${s[0].name}').authWithOAuth2({ provider: 'google' });

        // OR authenticate with manual OAuth2 code exchange
        // const authData = await pb.collection('${s[0].name}').authWithOAuth2Code(...);

        // after the above you can also access the auth data from the authStore
        console.log(pb.authStore.isValid);
        console.log(pb.authStore.token);
        console.log(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `,dart:`
        import 'package:pocketbase/pocketbase.dart';
        import 'package:url_launcher/url_launcher.dart';

        final pb = PocketBase('${s[3]}');

        ...

        // OAuth2 authentication with a single realtime call.
        //
        // Make sure to register ${s[3]}/api/oauth2-redirect as redirect url.
        final authData = await pb.collection('${s[0].name}').authWithOAuth2('google', (url) async {
          await launchUrl(url);
        });

        // OR authenticate with manual OAuth2 code exchange
        // final authData = await pb.collection('${s[0].name}').authWithOAuth2Code(...);

        // after the above you can also access the auth data from the authStore
        print(pb.authStore.isValid);
        print(pb.authStore.token);
        print(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `}}),C=new Ve({props:{content:"?expand=relField1,relField2.subRelField"}}),q=new Xe({props:{prefix:"record."}});let z=K(s[2]);const Me=e=>e[5].code;for(let e=0;e<z.length;e+=1){let t=Le(s,z,e),u=Me(t);De.set(u,$[e]=je(u,t))}let H=K(s[2]);const Ue=e=>e[5].code;for(let e=0;e<H.length;e+=1){let t=Fe(s,H,e),u=Ue(t);Pe.set(u,w[e]=He(u,t))}return{c(){l=o("h3"),n=_("Auth with OAuth2 ("),f=_(i),g=_(")"),d=h(),b=o("div"),b.innerHTML=`<p>Authenticate with an OAuth2 provider and returns a new auth token and record data.</p> <p>For more details please check the
        <a href="https://pocketbase.io/docs/authentication#authenticate-with-oauth2" target="_blank" rel="noopener noreferrer">OAuth2 integration documentation
        </a>.</p>`,k=h(),G(v.$$.fragment),O=h(),R=o("h6"),R.textContent="API details",X=h(),y=o("div"),E=o("strong"),E.textContent="POST",be=h(),J=o("div"),P=o("p"),me=_("/api/collections/"),Y=o("strong"),ee=_(N),fe=_("/auth-with-oauth2"),te=h(),M=o("div"),M.textContent="Body Parameters",ae=h(),U=o("table"),U.innerHTML=`<thead><tr><th>Param</th> <th>Type</th> <th width="50%">Description</th></tr></thead> <tbody><tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>provider</span></div></td> <td><span class="label">String</span></td> <td>The name of the OAuth2 client provider (eg. &quot;google&quot;).</td></tr> <tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>code</span></div></td> <td><span class="label">String</span></td> <td>The authorization code returned from the initial request.</td></tr> <tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>codeVerifier</span></div></td> <td><span class="label">String</span></td> <td>The code verifier sent with the initial request as part of the code_challenge.</td></tr> <tr><td><div class="inline-flex"><span class="label label-success">Required</span> <span>redirectURL</span></div></td> <td><span class="label">String</span></td> <td>The redirect url sent with the initial request.</td></tr> <tr><td><div class="inline-flex"><span class="label label-warning">Optional</span> <span>createData</span></div></td> <td><span class="label">Object</span></td> <td><p>Optional data that will be used when creating the auth record on OAuth2 sign-up.</p> <p>The created auth record must comply with the same requirements and validations in the
                    regular <strong>create</strong> action.
                    <br/> <em>The data can only be in <code>json</code>, aka. <code>multipart/form-data</code> and files
                        upload currently are not supported during OAuth2 sign-ups.</em></p></td></tr></tbody>`,le=h(),W=o("div"),W.textContent="Query parameters",ne=h(),A=o("table"),oe=o("thead"),oe.innerHTML='<tr><th>Param</th> <th>Type</th> <th width="60%">Description</th></tr>',ge=h(),B=o("tbody"),S=o("tr"),se=o("td"),se.textContent="expand",_e=h(),ie=o("td"),ie.innerHTML='<span class="label">String</span>',ke=h(),m=o("td"),ve=_(`Auto expand record relations. Ex.:
                `),G(C.$$.fragment),we=_(`
                Supports up to 6-levels depth nested relations expansion. `),$e=o("br"),Oe=_(`
                The expanded relations will be appended to the record under the
                `),re=o("code"),re.textContent="expand",ye=_(" property (eg. "),ce=o("code"),ce.textContent='"expand": {"relField1": {...}, ...}',Ae=_(`).
                `),Se=o("br"),Te=_(`
                Only the relations to which the request user has permissions to `),de=o("strong"),de.textContent="view",Ce=_(" will be expanded."),qe=h(),G(q.$$.fragment),ue=h(),F=o("div"),F.textContent="Responses",he=h(),T=o("div"),L=o("div");for(let e=0;e<$.length;e+=1)$[e].c();Re=h(),j=o("div");for(let e=0;e<w.length;e+=1)w[e].c();p(l,"class","m-b-sm"),p(b,"class","content txt-lg m-b-sm"),p(R,"class","m-b-xs"),p(E,"class","label label-primary"),p(J,"class","content"),p(y,"class","alert alert-success"),p(M,"class","section-title"),p(U,"class","table-compact table-border m-b-base"),p(W,"class","section-title"),p(A,"class","table-compact table-border m-b-base"),p(F,"class","section-title"),p(L,"class","tabs-header compact combined left"),p(j,"class","tabs-content"),p(T,"class","tabs")},m(e,t){c(e,l,t),a(l,n),a(l,f),a(l,g),c(e,d,t),c(e,b,t),c(e,k,t),Z(v,e,t),c(e,O,t),c(e,R,t),c(e,X,t),c(e,y,t),a(y,E),a(y,be),a(y,J),a(J,P),a(P,me),a(P,Y),a(Y,ee),a(P,fe),c(e,te,t),c(e,M,t),c(e,ae,t),c(e,U,t),c(e,le,t),c(e,W,t),c(e,ne,t),c(e,A,t),a(A,oe),a(A,ge),a(A,B),a(B,S),a(S,se),a(S,_e),a(S,ie),a(S,ke),a(S,m),a(m,ve),Z(C,m,null),a(m,we),a(m,$e),a(m,Oe),a(m,re),a(m,ye),a(m,ce),a(m,Ae),a(m,Se),a(m,Te),a(m,de),a(m,Ce),a(B,qe),Z(q,B,null),c(e,ue,t),c(e,F,t),c(e,he,t),c(e,T,t),a(T,L);for(let u=0;u<$.length;u+=1)$[u]&&$[u].m(L,null);a(T,Re),a(T,j);for(let u=0;u<w.length;u+=1)w[u]&&w[u].m(j,null);D=!0},p(e,[t]){(!D||t&1)&&i!==(i=e[0].name+"")&&pe(f,i);const u={};t&9&&(u.js=`
        import PocketBase from 'pocketbase';

        const pb = new PocketBase('${e[3]}');

        ...

        // OAuth2 authentication with a single realtime call.
        //
        // Make sure to register ${e[3]}/api/oauth2-redirect as redirect url.
        const authData = await pb.collection('${e[0].name}').authWithOAuth2({ provider: 'google' });

        // OR authenticate with manual OAuth2 code exchange
        // const authData = await pb.collection('${e[0].name}').authWithOAuth2Code(...);

        // after the above you can also access the auth data from the authStore
        console.log(pb.authStore.isValid);
        console.log(pb.authStore.token);
        console.log(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `),t&9&&(u.dart=`
        import 'package:pocketbase/pocketbase.dart';
        import 'package:url_launcher/url_launcher.dart';

        final pb = PocketBase('${e[3]}');

        ...

        // OAuth2 authentication with a single realtime call.
        //
        // Make sure to register ${e[3]}/api/oauth2-redirect as redirect url.
        final authData = await pb.collection('${e[0].name}').authWithOAuth2('google', (url) async {
          await launchUrl(url);
        });

        // OR authenticate with manual OAuth2 code exchange
        // final authData = await pb.collection('${e[0].name}').authWithOAuth2Code(...);

        // after the above you can also access the auth data from the authStore
        print(pb.authStore.isValid);
        print(pb.authStore.token);
        print(pb.authStore.record.id);

        // "logout"
        pb.authStore.clear();
    `),v.$set(u),(!D||t&1)&&N!==(N=e[0].name+"")&&pe(ee,N),t&6&&(z=K(e[2]),$=We($,t,Me,1,e,z,De,L,ze,je,null,Le)),t&6&&(H=K(e[2]),Ke(),w=We(w,t,Ue,1,e,H,Pe,j,Qe,He,null,Fe),Ze())},i(e){if(!D){x(v.$$.fragment,e),x(C.$$.fragment,e),x(q.$$.fragment,e);for(let t=0;t<H.length;t+=1)x(w[t]);D=!0}},o(e){V(v.$$.fragment,e),V(C.$$.fragment,e),V(q.$$.fragment,e);for(let t=0;t<w.length;t+=1)V(w[t]);D=!1},d(e){e&&(r(l),r(d),r(b),r(k),r(O),r(R),r(X),r(y),r(te),r(M),r(ae),r(U),r(le),r(W),r(ne),r(A),r(ue),r(F),r(he),r(T)),Q(v,e),Q(C),Q(q);for(let t=0;t<$.length;t+=1)$[t].d();for(let t=0;t<w.length;t+=1)w[t].d()}}}function et(s,l,n){let i,{collection:f}=l,g=200,d=[];const b=k=>n(1,g=k.code);return s.$$set=k=>{"collection"in k&&n(0,f=k.collection)},s.$$.update=()=>{s.$$.dirty&1&&n(2,d=[{code:200,body:JSON.stringify({token:"JWT_AUTH_TOKEN",record:Be.dummyCollectionRecord(f),meta:{id:"abc123",name:"John Doe",username:"john.doe",email:"test@example.com",avatarURL:"https://example.com/avatar.png",accessToken:"...",refreshToken:"...",expiry:"2022-01-01 10:00:00.123Z",isNew:!1,rawUser:{}}},null,2)},{code:400,body:`
                {
                  "status": 400,
                  "message": "An error occurred while submitting the form.",
                  "data": {
                    "provider": {
                      "code": "validation_required",
                      "message": "Missing required value."
                    }
                  }
                }
            `}])},n(3,i=Be.getApiExampleUrl(Ge.baseURL)),[f,g,d,i,b]}class lt extends xe{constructor(l){super(),Ee(this,l,et,Ye,Je,{collection:0})}}export{lt as default};
