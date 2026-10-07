(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["partials/header.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
output += "<site-navbar>\r\n  <nav class=\"navbar\">\r\n    <div class=\"container navbar-container\">\r\n      <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"home"), env.opts.autoescape);
output += "\" class=\"nav-brand\" aria-label=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"brand"), env.opts.autoescape);
output += "\">\r\n        <img src=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"logo"), env.opts.autoescape);
output += "\" alt=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"brand"), env.opts.autoescape);
output += "\" class=\"brand-logo-img\">\r\n      </a>\r\n      <div class=\"nav-links-wrapper\">\r\n        <ul class=\"nav-links\">\r\n";
frame = frame.push();
var t_3 = runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"navigation")),"links");
if(t_3) {t_3 = runtime.fromIterator(t_3);
var t_2 = t_3.length;
for(var t_1=0; t_1 < t_3.length; t_1++) {
var t_4 = t_3[t_1];
frame.set("link", t_4);
frame.set("loop.index", t_1 + 1);
frame.set("loop.index0", t_1);
frame.set("loop.revindex", t_2 - t_1);
frame.set("loop.revindex0", t_2 - t_1 - 1);
frame.set("loop.first", t_1 === 0);
frame.set("loop.last", t_1 === t_2 - 1);
frame.set("loop.length", t_2);
output += "\r\n          <li><a href=\"";
output += runtime.suppressValue(runtime.memberLookup((t_4),"url"), env.opts.autoescape);
output += "\" class=\"nav-link\"";
if(runtime.memberLookup((t_4),"newTab")) {
output += " target=\"_blank\" rel=\"noopener noreferrer\"";
;
}
output += ">";
output += runtime.suppressValue(runtime.memberLookup((t_4),"label"), env.opts.autoescape);
output += "</a></li>\r\n";
;
}
}
frame = frame.pop();
output += "\r\n        </ul>\r\n      </div>\r\n      <div class=\"nav-actions\">\r\n        <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"navigation")),"inworldUrl"), env.opts.autoescape);
output += "\" target=\"_blank\" rel=\"noopener\" class=\"btn btn-gold btn-sm\">\r\n          <span>&#128205;</span> ";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"navigation")),"inworldLabel"), env.opts.autoescape);
output += "\r\n        </a>\r\n        <button class=\"nav-toggle\" id=\"nav-toggle\" aria-label=\"Toggle navigation menu\" aria-expanded=\"false\" aria-controls=\"mobile-nav-drawer\">\r\n          <span class=\"hamburger-line\"></span>\r\n          <span class=\"hamburger-line\"></span>\r\n          <span class=\"hamburger-line\"></span>\r\n        </button>\r\n      </div>\r\n    </div>\r\n    <div class=\"mobile-nav-drawer\" id=\"mobile-nav-drawer\">\r\n      <ul class=\"mobile-nav-links\">\r\n";
frame = frame.push();
var t_7 = runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"navigation")),"links");
if(t_7) {t_7 = runtime.fromIterator(t_7);
var t_6 = t_7.length;
for(var t_5=0; t_5 < t_7.length; t_5++) {
var t_8 = t_7[t_5];
frame.set("link", t_8);
frame.set("loop.index", t_5 + 1);
frame.set("loop.index0", t_5);
frame.set("loop.revindex", t_6 - t_5);
frame.set("loop.revindex0", t_6 - t_5 - 1);
frame.set("loop.first", t_5 === 0);
frame.set("loop.last", t_5 === t_6 - 1);
frame.set("loop.length", t_6);
output += "\r\n        <li><a href=\"";
output += runtime.suppressValue(runtime.memberLookup((t_8),"url"), env.opts.autoescape);
output += "\" class=\"mobile-nav-link\"";
if(runtime.memberLookup((t_8),"newTab")) {
output += " target=\"_blank\" rel=\"noopener noreferrer\"";
;
}
output += "><span>";
output += runtime.suppressValue(runtime.memberLookup((t_8),"icon"), env.opts.autoescape);
output += "</span> ";
output += runtime.suppressValue(runtime.memberLookup((t_8),"label"), env.opts.autoescape);
output += "</a></li>\r\n";
;
}
}
frame = frame.pop();
output += "\r\n      </ul>\r\n      <div class=\"mobile-nav-actions\">\r\n        <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"navigation")),"inworldUrl"), env.opts.autoescape);
output += "\" target=\"_blank\" rel=\"noopener\" class=\"btn btn-gold btn-sm tw:[width:100%]\">\r\n          <span>&#128205;</span> ";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"navigation")),"inworldLabel"), env.opts.autoescape);
output += "\r\n        </a>\r\n      </div>\r\n    </div>\r\n  </nav>\r\n</site-navbar>";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();

(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["partials/footer.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
output += "<site-footer>\r\n  <footer class=\"footer\">\r\n    <div class=\"container\">\r\n";
if(!runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "page")),"whiteLabel")) {
output += "\r\n      <div class=\"footer-grid\">\r\n        <div>\r\n          <div class=\"footer-brand-wrap tw:[margin-bottom:14px]\">\r\n            <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"home"), env.opts.autoescape);
output += "\" class=\"nav-brand footer-nav-brand\" aria-label=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"brand"), env.opts.autoescape);
output += "\">\r\n              <img src=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"logo"), env.opts.autoescape);
output += "\" alt=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"brand"), env.opts.autoescape);
output += "\" class=\"footer-logo-img\">\r\n            </a>\r\n          </div>\r\n          <p class=\"footer-desc\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"footer")),"description"), env.opts.autoescape);
output += "</p>\r\n        </div>\r\n";
frame = frame.push();
var t_3 = runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"footer")),"columns");
if(t_3) {t_3 = runtime.fromIterator(t_3);
var t_2 = t_3.length;
for(var t_1=0; t_1 < t_3.length; t_1++) {
var t_4 = t_3[t_1];
frame.set("column", t_4);
frame.set("loop.index", t_1 + 1);
frame.set("loop.index0", t_1);
frame.set("loop.revindex", t_2 - t_1);
frame.set("loop.revindex0", t_2 - t_1 - 1);
frame.set("loop.first", t_1 === 0);
frame.set("loop.last", t_1 === t_2 - 1);
frame.set("loop.length", t_2);
output += "\r\n        <div class=\"footer-links-col\">\r\n          <div class=\"footer-col-title\">";
output += runtime.suppressValue(runtime.memberLookup((t_4),"title"), env.opts.autoescape);
output += "</div>\r\n";
frame = frame.push();
var t_7 = runtime.memberLookup((t_4),"links");
if(t_7) {t_7 = runtime.fromIterator(t_7);
var t_6 = t_7.length;
for(var t_5=0; t_5 < t_7.length; t_5++) {
var t_8 = t_7[t_5];
frame.set("link", t_8);
frame.set("loop.index", t_5 + 1);
frame.set("loop.index0", t_5);
frame.set("loop.revindex", t_6 - t_5);
frame.set("loop.revindex0", t_6 - t_5 - 1);
frame.set("loop.first", t_5 === 0);
frame.set("loop.last", t_5 === t_6 - 1);
frame.set("loop.length", t_6);
output += "\r\n          <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((t_8),"url"), env.opts.autoescape);
output += "\" class=\"footer-link\"";
if(runtime.memberLookup((t_8),"newTab")) {
output += " target=\"_blank\" rel=\"noopener noreferrer\"";
;
}
output += ">";
output += runtime.suppressValue(runtime.memberLookup((t_8),"label"), env.opts.autoescape);
output += "</a>\r\n";
;
}
}
frame = frame.pop();
output += "\r\n        </div>\r\n";
;
}
}
frame = frame.pop();
output += "\r\n      </div>\r\n";
;
}
output += "\r\n      <div class=\"footer-bottom\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "site")),"footer")),"copyright"), env.opts.autoescape);
output += "</div>\r\n    </div>\r\n  </footer>\r\n</site-footer>";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();

(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["partials/event-card.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
output += "<div class=\"card card-flex-column\" data-event-category=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"category"), env.opts.autoescape);
output += "\">\r\n  <div class=\"flex-between align-start mb-12 gap-8\">\r\n    <span class=\"section-tag font-2xs m-0\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"category_tag"), env.opts.autoescape);
output += "</span>\r\n    <span class=\"font-mono font-xs text-gold\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"date_display"), env.opts.autoescape);
output += "</span>\r\n  </div>\r\n  <h3 class=\"card-title font-md mb-10\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"title"), env.opts.autoescape);
output += "</h3>\r\n  <div class=\"font-xs text-muted mb-12 flex-row align-center gap-6\">\r\n    <span>&#128205;</span> <span>";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"location"), env.opts.autoescape);
output += "</span>\r\n  </div>\r\n  <p class=\"card-desc card-body-grow mb-20\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"description"), env.opts.autoescape);
output += "</p>\r\n  <div class=\"card-actions-bar\">\r\n    <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"calendarUrl"), env.opts.autoescape);
output += "\" target=\"_blank\" rel=\"noopener\" class=\"btn btn-gold btn-sm card-body-grow\">\r\n      <span>&#128197;</span> Add to Google Calendar\r\n    </a>\r\n    <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "event")),"slurl"), env.opts.autoescape);
output += "\" class=\"btn btn-secondary btn-sm\">\r\n      <span>&#128205;</span> Teleport (SLurl)\r\n    </a>\r\n  </div>\r\n</div>";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();

(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["partials/blog-card.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
output += "<div class=\"card\" data-blog-category=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"category"), env.opts.autoescape);
output += "\" data-blog-search=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"title"), env.opts.autoescape);
output += " ";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"summary"), env.opts.autoescape);
output += " ";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"author"), env.opts.autoescape);
output += "\">\r\n";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"featured_image")) {
output += "\r\n  <a class=\"blog-a-presentation\" href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"url"), env.opts.autoescape);
output += "\">\r\n    <img class=\"tw:[width:100%] tw:[height:100%] tw:[object-fit:cover] tw:[transition:transform_0.3s_ease]\" src=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"featured_image"), env.opts.autoescape);
output += "\" alt=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"title"), env.opts.autoescape);
output += "\" loading=\"lazy\">\r\n  </a>\r\n";
;
}
output += "\r\n  <div class=\"tw:[display:flex] tw:[justify-content:space-between] tw:[align-items:center] tw:[margin-bottom:10px]\">\r\n    <span class=\"section-tag tw:[margin:0] tw:[font-size:9.5px] tw:[padding:2px_8px]\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"category"), env.opts.autoescape);
output += "</span>\r\n    <span class=\"tw:[font-family:var(--font-mono)] tw:[font-size:11px] tw:[color:var(--gold-muted)]\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"date"), env.opts.autoescape);
output += " &#8226; ";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"author"), env.opts.autoescape);
output += "</span>\r\n  </div>\r\n  <h3 class=\"card-title tw:[font-size:20px] tw:[margin-bottom:10px] tw:[line-height:1.4]\">\r\n    <a class=\"tw:[color:#fff] tw:[text-decoration:none]\" href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"url"), env.opts.autoescape);
output += "\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"title"), env.opts.autoescape);
output += "</a>\r\n  </h3>\r\n  <p class=\"tw:[font-size:14px] tw:[color:#b0b0c5] tw:[line-height:1.6] tw:[margin-bottom:18px] tw:[flex:1]\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"summary"), env.opts.autoescape);
output += "</p>\r\n  <div class=\"tw:[border-top:1px_solid_rgba(255,255,255,0.06)] tw:[padding-top:14px] tw:[margin-top:auto]\">\r\n    <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "post")),"url"), env.opts.autoescape);
output += "\" class=\"btn btn-secondary btn-sm tw:[width:100%] tw:[justify-content:center]\">Read Full Post &#8594;</a>\r\n  </div>\r\n</div>";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();

(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["partials/guide-card.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
output += "<div class=\"card ";
if(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"listing")),"featured")) {
output += "card-highlight-gold ";
;
}
output += "card-flex-column\" data-cms-guide-card>\r\n  <div class=\"card-product-media\"><img src=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"listing")),"image"), env.opts.autoescape);
output += "\" alt=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"listing")),"title"), env.opts.autoescape);
output += "\" loading=\"lazy\"></div>\r\n  <span class=\"section-tag ";
if(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"listing")),"featured")) {
output += "tag-burgundy";
;
}
else {
output += "manifesto-tag";
;
}
output += " align-start mb-8\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"listing")),"badge"), env.opts.autoescape);
output += "</span>\r\n  <h3 class=\"card-title\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"listing")),"title"), env.opts.autoescape);
output += "</h3>\r\n  <p class=\"card-desc card-body-grow\">";
output += runtime.suppressValue(runtime.memberLookup((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"listing")),"description"), env.opts.autoescape);
output += "</p>\r\n  <div class=\"card-actions-bar\">\r\n    <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"url"), env.opts.autoescape);
output += "\" class=\"btn btn-gold btn-sm card-body-grow\">Read Manual &#8594;</a>\r\n";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"id") == "xp-titlers") {
output += "\r\n    <a href=\"/xp-system\" class=\"btn btn-secondary btn-sm\">&#9889; XP Levels</a>\r\n";
;
}
else {
output += "\r\n    <a href=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "guide")),"marketplace_url"), env.opts.autoescape);
output += "\" target=\"_blank\" rel=\"noopener\" class=\"btn btn-secondary btn-sm\">&#128722; Marketplace</a>\r\n";
;
}
output += "\r\n  </div>\r\n</div>";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();
