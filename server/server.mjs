// Pachi Monsters shared ownership and Futo delivery API.
// ADMIN_CLAIM_KEY is a runtime secret. Never place it in client code or source.
const BASE_ORIGIN = 'https://uni-tadayasu.github.io';
const encoder = new TextEncoder();
const DEFAULT_MOVES = ['futo_breaker', 'futo_burst', 'futo_ascend', 'futo_restore'];
export const MYTHICAL_CONFIG = Object.freeze({level:50, stats:Object.freeze({hp:510, atk:350, def:310, spAtk:390, spDef:330, speed:310, accuracy:110, evasion:105}), moves:Object.freeze(['verdant_lance','forest_crown','genesis_bloom','root_drain'])});
const LEGACY_DEFAULT_MOVES = ['supernova', 'atlas_crystal_4', 'starlight', 'shell'];
const BASIC_MOVES = 'sprout vine bloom wave surge mist spark blaze warmth gust storm shelter glint prism shell nudge lifeline evergreen thorn dew riptide ripple frost spring sunburst cinder phoenix heatveil tempest whisper feather sirocco supernova moonbeam facet starlight pulse focus restsong dawnstep'.split(' ');
const MOVE_IDS = new Set([...DEFAULT_MOVES, ...BASIC_MOVES, ...['leaf', 'tide', 'ember', 'wind', 'crystal'].flatMap(type => Array.from({length:12}, (_, i) => `atlas_${type}_${i + 1}`))]);
const STAT_LIMITS = {hp:99999, atk:9999, def:9999, spAtk:9999, spDef:9999, speed:9999, accuracy:300, evasion:300};
export const DEFAULT_CONFIG = Object.freeze({level:100, stats:Object.freeze({hp:500, atk:150, def:150, spAtk:180, spDef:150, speed:160, accuracy:110, evasion:100}), moves:Object.freeze(DEFAULT_MOVES)});

// Generated from the game catalog; ordinary species only, with exact PP bounds.
const TRADE_SPECIES = Object.freeze({"komori":{"hp":25,"pp":{"sprout":30,"nudge":30,"bloom":10,"lifeline":20}},"komorion":{"hp":39,"pp":{"vine":15,"nudge":30,"bloom":10,"lifeline":20}},"shizuku":{"hp":28,"pp":{"wave":30,"nudge":30,"mist":15,"frost":20}},"shizurua":{"hp":42,"pp":{"surge":15,"wave":30,"mist":15,"frost":20}},"hibana":{"hp":24,"pp":{"spark":30,"nudge":30,"warmth":10,"cinder":20}},"akebino":{"hp":37,"pp":{"blaze":15,"spark":30,"warmth":10,"cinder":20}},"fuwari":{"hp":22,"pp":{"gust":30,"nudge":30,"shelter":15,"whisper":20}},"sorahane":{"hp":35,"pp":{"storm":15,"gust":30,"shelter":15,"whisper":20}},"chirari":{"hp":21,"pp":{"spark":30,"gust":30,"warmth":10,"cinder":20}},"tomoriga":{"hp":33,"pp":{"blaze":15,"storm":15,"warmth":10,"cinder":20}},"nemuri":{"hp":30,"pp":{"sprout":30,"nudge":30,"shell":15,"lifeline":20}},"kodamori":{"hp":47,"pp":{"vine":15,"glint":30,"bloom":10,"lifeline":20}},"minamo":{"hp":25,"pp":{"wave":30,"gust":30,"mist":15,"frost":20}},"shionagi":{"hp":39,"pp":{"surge":15,"storm":15,"mist":15,"frost":20}},"kirari":{"hp":23,"pp":{"glint":30,"nudge":30,"shell":15,"facet":20}},"seiran":{"hp":37,"pp":{"prism":15,"wave":30,"shell":15,"facet":20}},"hatane":{"hp":29,"pp":{"vine":15,"gust":30,"bloom":10,"lifeline":20}},"sunokko":{"hp":32,"pp":{"storm":15,"nudge":30,"shelter":15,"whisper":20}},"kagetsu":{"hp":36,"pp":{"blaze":15,"glint":30,"warmth":10,"cinder":20}},"hoshiwa":{"hp":43,"pp":{"prism":15,"nudge":30,"shell":15,"facet":20}},"yorune":{"hp":32,"pp":{"storm":15,"glint":30,"shelter":15,"whisper":20}},"astralith":{"hp":48,"pp":{"prism":15,"storm":15,"shell":15,"facet":20}},"momiji":{"hp":24,"pp":{"sprout":30,"gust":30,"bloom":10,"nudge":30}},"akihane":{"hp":39,"pp":{"evergreen":10,"storm":15,"dew":10,"thorn":20}},"koromo":{"hp":28,"pp":{"sprout":30,"glint":30,"bloom":10,"focus":15}},"moriboshi":{"hp":44,"pp":{"evergreen":10,"moonbeam":20,"dew":10,"lifeline":20}},"tsumugi":{"hp":22,"pp":{"gust":30,"sprout":30,"feather":10,"nudge":30}},"orihime":{"hp":36,"pp":{"tempest":10,"vine":15,"feather":10,"whisper":20}},"suine":{"hp":25,"pp":{"wave":30,"gust":30,"spring":10,"nudge":30}},"suirei":{"hp":40,"pp":{"riptide":10,"storm":15,"spring":10,"ripple":30}},"sazanami":{"hp":30,"pp":{"wave":30,"nudge":30,"mist":15,"frost":20}},"shioshige":{"hp":47,"pp":{"riptide":10,"facet":20,"mist":15,"frost":20}},"sunari":{"hp":25,"pp":{"spark":30,"sirocco":20,"warmth":10,"nudge":30}},"sabaryo":{"hp":43,"pp":{"sunburst":10,"sirocco":20,"phoenix":10,"cinder":20}},"honoha":{"hp":24,"pp":{"spark":30,"gust":30,"warmth":10,"nudge":30}},"enraku":{"hp":40,"pp":{"sunburst":10,"tempest":10,"phoenix":10,"cinder":20}},"kourin":{"hp":26,"pp":{"glint":30,"frost":20,"shell":15,"nudge":30}},"setsurei":{"hp":45,"pp":{"supernova":10,"frost":20,"starlight":10,"facet":20}},"yukumo":{"hp":34,"pp":{"wave":30,"nudge":30,"spring":10,"shell":15}},"hakurou":{"hp":54,"pp":{"riptide":10,"pulse":20,"spring":10,"frost":20}},"raito":{"hp":27,"pp":{"glint":30,"nudge":30,"shell":15,"facet":20}},"raigai":{"hp":44,"pp":{"supernova":10,"pulse":20,"shell":15,"facet":20}},"sorami":{"hp":26,"pp":{"gust":30,"wave":30,"feather":10,"nudge":30}},"amakumo":{"hp":43,"pp":{"tempest":10,"riptide":10,"feather":10,"whisper":20}},"kuroto":{"hp":23,"pp":{"glint":30,"gust":30,"starlight":10,"nudge":30}},"yorutsuki":{"hp":38,"pp":{"supernova":10,"tempest":10,"starlight":10,"moonbeam":20}},"irisowl":{"hp":46,"pp":{"tempest":10,"facet":20,"feather":10,"shelter":15}},"mosselk":{"hp":46,"pp":{"evergreen":10,"lifeline":20,"dew":10,"shell":15}},"cocoroc":{"hp":55,"pp":{"evergreen":10,"lifeline":20,"dew":10,"focus":15}},"sahari":{"hp":40,"pp":{"sunburst":10,"sirocco":20,"heatveil":15,"cinder":20}},"enneko":{"hp":38,"pp":{"sunburst":10,"moonbeam":20,"phoenix":10,"cinder":20}},"tobari":{"hp":42,"pp":{"tempest":10,"whisper":20,"feather":10,"facet":20}},"rurihime":{"hp":39,"pp":{"riptide":10,"moonbeam":20,"spring":10,"ripple":30}},"sangoro":{"hp":49,"pp":{"riptide":10,"frost":20,"mist":15,"pulse":20}},"lazur":{"hp":55,"pp":{"supernova":10,"facet":20,"shell":15,"starlight":10}},"yashiro":{"hp":58,"pp":{"supernova":10,"pulse":20,"shell":15,"starlight":10}},"gurenka":{"hp":49,"pp":{"sunburst":10,"tempest":10,"phoenix":10,"cinder":20}},"aotori":{"hp":60,"pp":{"riptide":10,"tempest":10,"spring":10,"ripple":30}},"silfara":{"hp":52,"pp":{"tempest":10,"moonbeam":20,"feather":10,"sirocco":20}},"luminarch":{"hp":58,"pp":{"evergreen":10,"supernova":10,"dew":10,"lifeline":20}},"tanemaru":{"hp":25,"pp":{"atlas_leaf_1":30,"atlas_leaf_4":10,"atlas_ember_6":15,"atlas_leaf_9":10}},"fukumori":{"hp":41,"pp":{"atlas_leaf_2":20,"atlas_leaf_5":30,"atlas_wind_7":20,"atlas_leaf_9":10}},"saikaju":{"hp":45,"pp":{"atlas_leaf_3":15,"atlas_leaf_6":15,"atlas_crystal_8":10,"atlas_leaf_10":10}},"ruron":{"hp":34,"pp":{"atlas_tide_1":30,"atlas_tide_4":10,"atlas_wind_6":15,"atlas_tide_9":10}},"mizukane":{"hp":38,"pp":{"atlas_tide_2":15,"atlas_tide_5":30,"atlas_crystal_7":20,"atlas_tide_9":10}},"suirinka":{"hp":54,"pp":{"atlas_tide_3":15,"atlas_tide_6":15,"atlas_leaf_8":15,"atlas_tide_10":10}},"hikumaru":{"hp":31,"pp":{"atlas_ember_1":30,"atlas_ember_4":10,"atlas_crystal_6":15,"atlas_ember_9":10}},"akazuchi":{"hp":35,"pp":{"atlas_ember_2":15,"atlas_ember_5":30,"atlas_leaf_7":20,"atlas_ember_9":10}},"akakagura":{"hp":51,"pp":{"atlas_ember_3":15,"atlas_ember_6":15,"atlas_tide_8":10,"atlas_ember_10":10}},"piyumu":{"hp":28,"pp":{"atlas_wind_1":30,"atlas_wind_4":10,"atlas_leaf_6":15,"atlas_wind_9":10}},"kazaharu":{"hp":44,"pp":{"atlas_wind_2":20,"atlas_wind_5":30,"atlas_tide_7":20,"atlas_wind_9":10}},"soramado":{"hp":48,"pp":{"atlas_wind_3":15,"atlas_wind_6":15,"atlas_ember_8":10,"atlas_wind_10":10}},"chokori":{"hp":25,"pp":{"atlas_crystal_1":30,"atlas_crystal_4":10,"atlas_tide_6":15,"atlas_crystal_9":10}},"sekkura":{"hp":41,"pp":{"atlas_crystal_2":15,"atlas_crystal_5":20,"atlas_ember_7":20,"atlas_crystal_9":10}},"sekkokyo":{"hp":45,"pp":{"atlas_crystal_3":10,"atlas_crystal_6":15,"atlas_wind_8":15,"atlas_crystal_10":10}},"tsurune":{"hp":34,"pp":{"atlas_leaf_4":10,"atlas_leaf_7":20,"atlas_ember_1":30,"atlas_leaf_10":10}},"hagalune":{"hp":38,"pp":{"atlas_leaf_5":30,"atlas_leaf_8":15,"atlas_wind_2":20,"atlas_leaf_11":15}},"shinjuka":{"hp":54,"pp":{"atlas_leaf_6":15,"atlas_leaf_1":30,"atlas_crystal_3":10,"atlas_leaf_11":15}},"nakakiri":{"hp":31,"pp":{"atlas_tide_4":10,"atlas_tide_7":20,"atlas_wind_1":30,"atlas_tide_10":10}},"umikiri":{"hp":35,"pp":{"atlas_tide_5":30,"atlas_tide_8":10,"atlas_crystal_2":15,"atlas_tide_11":15}},"umihibiki":{"hp":51,"pp":{"atlas_tide_6":15,"atlas_tide_1":30,"atlas_leaf_3":15,"atlas_tide_11":15}},"lumitomo":{"hp":28,"pp":{"atlas_ember_4":10,"atlas_ember_7":20,"atlas_crystal_1":30,"atlas_ember_10":10}},"yorutomo":{"hp":44,"pp":{"atlas_ember_5":30,"atlas_ember_8":10,"atlas_leaf_2":20,"atlas_ember_11":15}},"akatsubame":{"hp":48,"pp":{"atlas_ember_6":15,"atlas_ember_1":30,"atlas_tide_3":15,"atlas_ember_11":15}},"fukiho":{"hp":25,"pp":{"atlas_wind_4":10,"atlas_wind_7":20,"atlas_leaf_1":30,"atlas_wind_10":10}},"fukiryu":{"hp":41,"pp":{"atlas_wind_5":30,"atlas_wind_8":15,"atlas_tide_2":15,"atlas_wind_11":15}},"kuchuri":{"hp":27,"pp":{"atlas_crystal_4":10,"atlas_crystal_7":20,"atlas_wind_1":30,"atlas_crystal_10":10}},"kujyura":{"hp":43,"pp":{"atlas_crystal_5":20,"atlas_crystal_8":10,"atlas_tide_2":15,"atlas_crystal_11":15}},"mofuri":{"hp":29,"pp":{"atlas_leaf_7":20,"atlas_leaf_2":20,"atlas_wind_4":10,"atlas_leaf_12":15}},"mofurou":{"hp":45,"pp":{"atlas_leaf_8":15,"atlas_leaf_3":15,"atlas_crystal_5":20,"atlas_leaf_12":15}},"hakone":{"hp":31,"pp":{"atlas_wind_6":15,"atlas_wind_1":30,"atlas_leaf_3":15,"atlas_wind_11":15}},"hakozora":{"hp":35,"pp":{"atlas_wind_7":20,"atlas_wind_2":20,"atlas_tide_4":10,"atlas_wind_12":15}},"sorotto":{"hp":33,"pp":{"atlas_wind_8":15,"atlas_wind_3":15,"atlas_ember_5":30,"atlas_wind_12":15}},"sorotora":{"hp":37,"pp":{"atlas_wind_1":30,"atlas_wind_4":10,"atlas_leaf_6":15,"atlas_wind_9":10}},"nagin":{"hp":35,"pp":{"atlas_tide_7":20,"atlas_tide_2":15,"atlas_crystal_4":10,"atlas_tide_12":15}},"naginori":{"hp":39,"pp":{"atlas_tide_8":10,"atlas_tide_3":15,"atlas_leaf_5":30,"atlas_tide_12":15}},"sibuki":{"hp":25,"pp":{"atlas_tide_1":30,"atlas_tide_4":10,"atlas_wind_6":15,"atlas_tide_9":10}},"shibunami":{"hp":41,"pp":{"atlas_tide_2":15,"atlas_tide_5":30,"atlas_crystal_7":20,"atlas_tide_9":10}},"sumina":{"hp":27,"pp":{"atlas_ember_7":20,"atlas_ember_2":15,"atlas_tide_4":10,"atlas_ember_12":15}},"sumirekka":{"hp":43,"pp":{"atlas_ember_8":10,"atlas_ember_3":15,"atlas_crystal_5":20,"atlas_ember_12":15}},"kanero":{"hp":29,"pp":{"atlas_crystal_6":15,"atlas_crystal_1":30,"atlas_ember_3":15,"atlas_crystal_11":15}},"kanedora":{"hp":45,"pp":{"atlas_crystal_7":20,"atlas_crystal_2":15,"atlas_wind_4":10,"atlas_crystal_12":15}},"amaguri":{"hp":31,"pp":{"atlas_leaf_1":30,"atlas_leaf_4":10,"atlas_ember_6":15,"atlas_leaf_9":10}},"amagurio":{"hp":35,"pp":{"atlas_leaf_2":20,"atlas_leaf_5":30,"atlas_wind_7":20,"atlas_leaf_9":10}},"nukumi":{"hp":33,"pp":{"atlas_ember_1":30,"atlas_ember_4":10,"atlas_tide_6":15,"atlas_ember_9":10}},"nukumaru":{"hp":37,"pp":{"atlas_ember_2":15,"atlas_ember_5":30,"atlas_crystal_7":20,"atlas_ember_9":10}},"kiraho":{"hp":35,"pp":{"atlas_crystal_8":10,"atlas_crystal_3":10,"atlas_ember_5":30,"atlas_crystal_12":15}},"kirawashi":{"hp":39,"pp":{"atlas_crystal_1":30,"atlas_crystal_4":10,"atlas_wind_6":15,"atlas_crystal_9":10}},"hazumi":{"hp":25,"pp":{"atlas_leaf_3":15,"atlas_leaf_6":15,"atlas_ember_8":10,"atlas_leaf_10":10}},"hazuhane":{"hp":41,"pp":{"atlas_leaf_4":10,"atlas_leaf_7":20,"atlas_wind_1":30,"atlas_leaf_10":10}},"shiori":{"hp":27,"pp":{"atlas_tide_3":15,"atlas_tide_6":15,"atlas_leaf_8":15,"atlas_tide_10":10}},"shioraku":{"hp":43,"pp":{"atlas_tide_4":10,"atlas_tide_7":20,"atlas_wind_1":30,"atlas_tide_10":10}},"torone":{"hp":29,"pp":{"atlas_wind_2":20,"atlas_wind_5":30,"atlas_tide_7":20,"atlas_wind_9":10}},"toronari":{"hp":45,"pp":{"atlas_wind_3":15,"atlas_wind_6":15,"atlas_ember_8":10,"atlas_wind_10":10}},"hoshimi":{"hp":31,"pp":{"atlas_crystal_2":15,"atlas_crystal_5":20,"atlas_tide_7":20,"atlas_crystal_9":10}},"hoshimori":{"hp":35,"pp":{"atlas_crystal_3":10,"atlas_crystal_6":15,"atlas_ember_8":10,"atlas_crystal_10":10}},"riyuna":{"hp":33,"pp":{"atlas_tide_5":30,"atlas_tide_8":10,"atlas_leaf_2":20,"atlas_tide_11":15}},"riyutai":{"hp":37,"pp":{"atlas_tide_6":15,"atlas_tide_1":30,"atlas_wind_3":15,"atlas_tide_11":15}},"nomori":{"hp":35,"pp":{"atlas_leaf_5":30,"atlas_leaf_8":15,"atlas_wind_2":20,"atlas_leaf_11":15}},"nomorika":{"hp":39,"pp":{"atlas_leaf_6":15,"atlas_leaf_1":30,"atlas_crystal_3":10,"atlas_leaf_11":15}},"ennori":{"hp":25,"pp":{"atlas_ember_3":15,"atlas_ember_6":15,"atlas_crystal_8":10,"atlas_ember_10":10}},"ennoraku":{"hp":41,"pp":{"atlas_ember_4":10,"atlas_ember_7":20,"atlas_leaf_1":30,"atlas_ember_10":10}},"yurushi":{"hp":27,"pp":{"atlas_tide_7":20,"atlas_tide_2":15,"atlas_leaf_4":10,"atlas_tide_12":15}},"yurushio":{"hp":43,"pp":{"atlas_tide_8":10,"atlas_tide_3":15,"atlas_wind_5":30,"atlas_tide_12":15}},"nureha":{"hp":29,"pp":{"atlas_leaf_7":20,"atlas_leaf_2":20,"atlas_wind_4":10,"atlas_leaf_12":15}},"tousa":{"hp":36,"pp":{"atlas_wind_4":10,"atlas_wind_7":20,"atlas_ember_1":30,"atlas_wind_10":10}},"fukuro":{"hp":31,"pp":{"atlas_leaf_8":15,"atlas_leaf_3":15,"atlas_ember_5":30,"atlas_leaf_12":15}},"aonagi":{"hp":26,"pp":{"atlas_tide_1":30,"atlas_tide_4":10,"atlas_crystal_6":15,"atlas_tide_9":10}},"oshire":{"hp":33,"pp":{"atlas_crystal_4":10,"atlas_crystal_7":20,"atlas_wind_1":30,"atlas_crystal_10":10}},"kagaru":{"hp":28,"pp":{"atlas_ember_5":30,"atlas_ember_8":10,"atlas_crystal_2":15,"atlas_ember_11":15}},"murasora":{"hp":35,"pp":{"atlas_wind_5":30,"atlas_wind_8":15,"atlas_tide_2":15,"atlas_wind_11":15}},"yamone":{"hp":30,"pp":{"atlas_leaf_1":30,"atlas_leaf_4":10,"atlas_crystal_6":15,"atlas_leaf_9":10}},"sazuka":{"hp":25,"pp":{"atlas_tide_2":15,"atlas_tide_5":30,"atlas_wind_7":20,"atlas_tide_9":10}},"tobine":{"hp":32,"pp":{"atlas_wind_6":15,"atlas_wind_1":30,"atlas_tide_3":15,"atlas_wind_11":15}},"genro":{"hp":27,"pp":{"atlas_crystal_5":20,"atlas_crystal_8":10,"atlas_wind_2":20,"atlas_crystal_11":15}},"enritsu":{"hp":34,"pp":{"atlas_ember_6":15,"atlas_ember_1":30,"atlas_crystal_3":10,"atlas_ember_11":15}},"shimarune":{"hp":29,"pp":{"atlas_crystal_6":15,"atlas_crystal_1":30,"atlas_ember_3":15,"atlas_crystal_11":15}},"kuromado":{"hp":36,"pp":{"atlas_crystal_7":20,"atlas_crystal_2":15,"atlas_wind_4":10,"atlas_crystal_12":15}},"suiraku":{"hp":31,"pp":{"atlas_tide_3":15,"atlas_tide_6":15,"atlas_wind_8":15,"atlas_tide_10":10}},"haneko":{"hp":26,"pp":{"atlas_leaf_2":20,"atlas_leaf_5":30,"atlas_wind_7":20,"atlas_leaf_9":10}},"toganashi":{"hp":33,"pp":{"atlas_leaf_3":15,"atlas_leaf_6":15,"atlas_crystal_8":10,"atlas_leaf_10":10}},"mairaku":{"hp":28,"pp":{"atlas_ember_7":20,"atlas_ember_2":15,"atlas_crystal_4":10,"atlas_ember_12":15}},"shigureh":{"hp":35,"pp":{"atlas_wind_7":20,"atlas_wind_2":20,"atlas_tide_4":10,"atlas_wind_12":15}},"hotarune":{"hp":30,"pp":{"atlas_ember_8":10,"atlas_ember_3":15,"atlas_tide_5":30,"atlas_ember_12":15}},"sumizora":{"hp":25,"pp":{"atlas_wind_8":15,"atlas_wind_3":15,"atlas_leaf_5":30,"atlas_wind_12":15}},"harune":{"hp":32,"pp":{"atlas_leaf_4":10,"atlas_leaf_7":20,"atlas_wind_1":30,"atlas_leaf_10":10}},"namisora":{"hp":27,"pp":{"atlas_tide_4":10,"atlas_tide_7":20,"atlas_leaf_1":30,"atlas_tide_10":10}},"ringetsu":{"hp":34,"pp":{"atlas_crystal_8":10,"atlas_crystal_3":10,"dawnstep":15,"atlas_crystal_12":15}},"kohakuon":{"hp":29,"pp":{"atlas_ember_1":30,"atlas_ember_4":10,"atlas_leaf_6":15,"atlas_ember_9":10}},"tokimori":{"hp":36,"pp":{"atlas_leaf_5":30,"atlas_leaf_8":15,"atlas_crystal_2":15,"restsong":10}},"yoruumi":{"hp":31,"pp":{"atlas_tide_5":30,"atlas_tide_8":10,"atlas_wind_2":20,"atlas_tide_11":15}},"velora_1":{"hp":26,"pp":{"sprout":30,"evergreen":10,"bloom":10,"pulse":20}},"velora_2":{"hp":36,"pp":{"vine":15,"thorn":20,"dew":10,"pulse":20}},"velora_3":{"hp":46,"pp":{"lifeline":20,"atlas_leaf_1":30,"atlas_leaf_9":10,"dawnstep":15}},"nereid_1":{"hp":27,"pp":{"surge":15,"frost":20,"spring":10,"pulse":20}},"nereid_2":{"hp":37,"pp":{"riptide":10,"atlas_tide_1":30,"atlas_tide_9":10,"pulse":20}},"nereid_3":{"hp":47,"pp":{"ripple":30,"atlas_tide_2":15,"atlas_tide_10":10,"dawnstep":15}},"ignox_1":{"hp":28,"pp":{"sunburst":10,"atlas_ember_2":15,"heatveil":15,"pulse":20}},"ignox_2":{"hp":38,"pp":{"cinder":20,"atlas_ember_3":15,"atlas_ember_9":10,"pulse":20}},"ignox_3":{"hp":48,"pp":{"atlas_ember_1":30,"atlas_ember_4":10,"atlas_ember_10":10,"dawnstep":15}},"aerlyn_1":{"hp":29,"pp":{"whisper":20,"atlas_wind_2":20,"atlas_wind_10":10,"pulse":20}},"aerlyn_2":{"hp":39,"pp":{"sirocco":20,"atlas_wind_3":15,"atlas_wind_11":15,"pulse":20}},"aerlyn_3":{"hp":49,"pp":{"atlas_wind_1":30,"atlas_wind_4":10,"atlas_wind_12":15,"dawnstep":15}},"quartz_1":{"hp":30,"pp":{"facet":20,"atlas_crystal_3":10,"atlas_crystal_11":15,"pulse":20}},"quartz_2":{"hp":40,"pp":{"atlas_crystal_1":30,"atlas_crystal_4":10,"atlas_crystal_12":15,"pulse":20}},"quartz_3":{"hp":50,"pp":{"atlas_crystal_2":15,"atlas_crystal_5":20,"shell":15,"dawnstep":15}},"papilio_1":{"hp":31,"pp":{"atlas_leaf_1":30,"atlas_leaf_4":10,"atlas_leaf_12":15,"pulse":20}},"papilio_2":{"hp":41,"pp":{"atlas_leaf_2":20,"atlas_leaf_5":30,"bloom":10,"pulse":20}},"papilio_3":{"hp":51,"pp":{"atlas_leaf_3":15,"atlas_leaf_6":15,"dew":10,"dawnstep":15}},"brine_1":{"hp":32,"pp":{"atlas_tide_2":15,"atlas_tide_5":30,"mist":15,"pulse":20}},"brine_2":{"hp":42,"pp":{"atlas_tide_3":15,"atlas_tide_6":15,"spring":10,"pulse":20}},"brine_3":{"hp":52,"pp":{"atlas_tide_4":10,"atlas_tide_7":20,"atlas_tide_9":10,"dawnstep":15}},"carmine_1":{"hp":33,"pp":{"atlas_ember_4":10,"atlas_ember_7":20,"warmth":10,"pulse":20}},"carmine_2":{"hp":43,"pp":{"atlas_ember_5":30,"atlas_ember_8":10,"phoenix":10,"pulse":20}},"carmine_3":{"hp":53,"pp":{"atlas_ember_6":15,"spark":30,"heatveil":15,"dawnstep":15}},"gale_1":{"hp":34,"pp":{"atlas_wind_4":10,"atlas_wind_7":20,"atlas_wind_9":10,"pulse":20}},"gale_2":{"hp":44,"pp":{"atlas_wind_5":30,"atlas_wind_8":15,"atlas_wind_10":10,"pulse":20}},"gale_3":{"hp":54,"pp":{"atlas_wind_6":15,"gust":30,"atlas_wind_11":15,"dawnstep":15}},"opal_1":{"hp":26,"pp":{"atlas_crystal_5":20,"atlas_crystal_8":10,"atlas_crystal_10":10,"pulse":20}},"opal_2":{"hp":36,"pp":{"atlas_crystal_6":15,"glint":30,"atlas_crystal_11":15,"pulse":20}},"opal_3":{"hp":46,"pp":{"atlas_crystal_7":20,"prism":15,"atlas_crystal_12":15,"dawnstep":15}},"thorn_1":{"hp":27,"pp":{"atlas_leaf_6":15,"sprout":30,"atlas_leaf_11":15,"pulse":20}},"thorn_2":{"hp":37,"pp":{"atlas_leaf_7":20,"vine":15,"atlas_leaf_12":15,"pulse":20}},"thorn_3":{"hp":47,"pp":{"atlas_leaf_8":15,"lifeline":20,"bloom":10,"dawnstep":15}},"rill_1":{"hp":28,"pp":{"atlas_tide_7":20,"surge":15,"atlas_tide_12":15,"pulse":20}},"rill_2":{"hp":38,"pp":{"atlas_tide_8":10,"riptide":10,"mist":15,"pulse":20}},"rill_3":{"hp":48,"pp":{"wave":30,"ripple":30,"spring":10,"dawnstep":15}},"ferrum_1":{"hp":29,"pp":{"spark":30,"cinder":20,"atlas_ember_11":15,"pulse":20}},"ferrum_2":{"hp":39,"pp":{"blaze":15,"atlas_ember_1":30,"atlas_ember_12":15,"pulse":20}},"ferrum_3":{"hp":49,"pp":{"sunburst":10,"atlas_ember_2":15,"warmth":10,"dawnstep":15}},"cirrus_1":{"hp":30,"pp":{"gust":30,"whisper":20,"feather":10,"pulse":20}},"cirrus_2":{"hp":40,"pp":{"storm":15,"sirocco":20,"atlas_wind_9":10,"pulse":20}},"cirrus_3":{"hp":50,"pp":{"tempest":10,"atlas_wind_1":30,"atlas_wind_10":10,"dawnstep":15}},"obsidian_1":{"hp":31,"pp":{"prism":15,"facet":20,"atlas_crystal_9":10,"pulse":20}},"obsidian_2":{"hp":41,"pp":{"supernova":10,"atlas_crystal_1":30,"atlas_crystal_10":10,"pulse":20}},"obsidian_3":{"hp":51,"pp":{"moonbeam":20,"atlas_crystal_2":15,"atlas_crystal_11":15,"dawnstep":15}},"saffron_1":{"hp":32,"pp":{"lifeline":20,"atlas_leaf_1":30,"atlas_leaf_10":10,"pulse":20}},"saffron_2":{"hp":42,"pp":{"evergreen":10,"atlas_leaf_2":20,"atlas_leaf_11":15,"pulse":20}},"saffron_3":{"hp":52,"pp":{"thorn":20,"atlas_leaf_3":15,"atlas_leaf_12":15,"dawnstep":15}},"abyss_1":{"hp":33,"pp":{"ripple":30,"atlas_tide_2":15,"atlas_tide_11":15,"pulse":20}},"abyss_2":{"hp":43,"pp":{"frost":20,"atlas_tide_3":15,"atlas_tide_12":15,"pulse":20}},"abyss_3":{"hp":53,"pp":{"atlas_tide_1":30,"atlas_tide_4":10,"mist":15,"dawnstep":15}},"flint_1":{"hp":34,"pp":{"atlas_ember_2":15,"atlas_ember_5":30,"atlas_ember_9":10,"pulse":20}},"flint_2":{"hp":44,"pp":{"atlas_ember_3":15,"atlas_ember_6":15,"atlas_ember_10":10,"pulse":20}},"flint_3":{"hp":54,"pp":{"atlas_ember_4":10,"atlas_ember_7":20,"atlas_ember_11":15,"dawnstep":15}},"volt_1":{"hp":26,"pp":{"atlas_wind_1":30,"atlas_wind_4":10,"shelter":15,"pulse":20}},"volt_2":{"hp":36,"pp":{"atlas_wind_2":20,"atlas_wind_5":30,"feather":10,"pulse":20}},"volt_3":{"hp":46,"pp":{"atlas_wind_3":15,"atlas_wind_6":15,"atlas_wind_9":10,"dawnstep":15}},"lunette_1":{"hp":27,"pp":{"atlas_crystal_2":15,"atlas_crystal_5":20,"starlight":10,"pulse":20}},"lunette_2":{"hp":37,"pp":{"atlas_crystal_3":10,"atlas_crystal_6":15,"atlas_crystal_9":10,"pulse":20}},"lunette_3":{"hp":47,"pp":{"atlas_crystal_4":10,"atlas_crystal_7":20,"atlas_crystal_10":10,"dawnstep":15}},"cedran_1":{"hp":28,"pp":{"atlas_leaf_3":15,"atlas_leaf_6":15,"atlas_leaf_9":10,"pulse":20}},"cedran_2":{"hp":38,"pp":{"atlas_leaf_4":10,"atlas_leaf_7":20,"atlas_leaf_10":10,"pulse":20}},"cedran_3":{"hp":48,"pp":{"atlas_leaf_5":30,"atlas_leaf_8":15,"atlas_leaf_11":15,"dawnstep":15}},"corall_1":{"hp":29,"pp":{"atlas_tide_4":10,"atlas_tide_7":20,"atlas_tide_10":10,"pulse":20}},"corall_2":{"hp":39,"pp":{"atlas_tide_5":30,"atlas_tide_8":10,"atlas_tide_11":15,"pulse":20}},"corall_3":{"hp":49,"pp":{"atlas_tide_6":15,"wave":30,"atlas_tide_12":15,"dawnstep":15}},"vermion_1":{"hp":30,"pp":{"atlas_ember_7":20,"blaze":15,"phoenix":10,"pulse":20}},"vermion_2":{"hp":40,"pp":{"atlas_ember_8":10,"sunburst":10,"heatveil":15,"pulse":20}},"vermion_3":{"hp":50,"pp":{"spark":30,"cinder":20,"atlas_ember_9":10,"dawnstep":15}},"zephyr_1":{"hp":31,"pp":{"atlas_wind_6":15,"gust":30,"atlas_wind_12":15,"pulse":20}},"zephyr_2":{"hp":41,"pp":{"atlas_wind_7":20,"storm":15,"shelter":15,"pulse":20}},"zephyr_3":{"hp":51,"pp":{"atlas_wind_8":15,"tempest":10,"feather":10,"dawnstep":15}},"aurora_1":{"hp":32,"pp":{"atlas_crystal_7":20,"prism":15,"shell":15,"pulse":20}},"aurora_2":{"hp":42,"pp":{"atlas_crystal_8":10,"supernova":10,"starlight":10,"pulse":20}},"aurora_3":{"hp":52,"pp":{"glint":30,"moonbeam":20,"atlas_crystal_9":10,"dawnstep":15}},"fernix_1":{"hp":33,"pp":{"atlas_leaf_8":15,"lifeline":20,"dew":10,"pulse":20}},"fernix_2":{"hp":43,"pp":{"sprout":30,"evergreen":10,"atlas_leaf_9":10,"pulse":20}},"fernix_3":{"hp":53,"pp":{"vine":15,"thorn":20,"atlas_leaf_10":10,"dawnstep":15}},"pelagic_1":{"hp":34,"pp":{"wave":30,"ripple":30,"atlas_tide_9":10,"pulse":20}},"pelagic_2":{"hp":44,"pp":{"surge":15,"frost":20,"atlas_tide_10":10,"pulse":20}},"pelagic_3":{"hp":54,"pp":{"riptide":10,"atlas_tide_1":30,"atlas_tide_11":15,"dawnstep":15}},"solstice_1":{"hp":26,"pp":{"cinder":20,"atlas_ember_3":15,"atlas_ember_12":15,"pulse":20}},"solstice_2":{"hp":36,"pp":{"atlas_ember_1":30,"atlas_ember_4":10,"warmth":10,"pulse":20}},"solstice_3":{"hp":46,"pp":{"atlas_ember_2":15,"atlas_ember_5":30,"phoenix":10,"dawnstep":15}},"stratus_1":{"hp":27,"pp":{"tempest":10,"atlas_wind_1":30,"atlas_wind_11":15,"pulse":20}},"stratus_2":{"hp":37,"pp":{"whisper":20,"atlas_wind_2":20,"atlas_wind_12":15,"pulse":20}},"stratus_3":{"hp":47,"pp":{"sirocco":20,"atlas_wind_3":15,"shelter":15,"dawnstep":15}},"noctil_1":{"hp":28,"pp":{"moonbeam":20,"atlas_crystal_2":15,"atlas_crystal_12":15,"pulse":20}},"noctil_2":{"hp":38,"pp":{"facet":20,"atlas_crystal_3":10,"shell":15,"pulse":20}},"noctil_3":{"hp":48,"pp":{"atlas_crystal_1":30,"atlas_crystal_4":10,"starlight":10,"dawnstep":15}},"bromel_1":{"hp":29,"pp":{"thorn":20,"atlas_leaf_3":15,"bloom":10,"pulse":20}},"bromel_2":{"hp":39,"pp":{"atlas_leaf_1":30,"atlas_leaf_4":10,"dew":10,"pulse":20}},"bromel_3":{"hp":49,"pp":{"atlas_leaf_2":20,"atlas_leaf_5":30,"atlas_leaf_9":10,"dawnstep":15}},"isola_1":{"hp":30,"pp":{"atlas_tide_1":30,"atlas_tide_4":10,"spring":10,"pulse":20}},"isola_2":{"hp":40,"pp":{"atlas_tide_2":15,"atlas_tide_5":30,"atlas_tide_9":10,"pulse":20}},"isola_3":{"hp":50,"pp":{"atlas_tide_3":15,"atlas_tide_6":15,"atlas_tide_10":10,"dawnstep":15}},"pyrrha_1":{"hp":31,"pp":{"atlas_ember_5":30,"atlas_ember_8":10,"atlas_ember_10":10,"pulse":20}},"pyrrha_2":{"hp":41,"pp":{"atlas_ember_6":15,"spark":30,"atlas_ember_11":15,"pulse":20}},"pyrrha_3":{"hp":51,"pp":{"atlas_ember_7":20,"blaze":15,"atlas_ember_12":15,"dawnstep":15}},"skarn_1":{"hp":32,"pp":{"atlas_crystal_3":10,"atlas_crystal_6":15,"atlas_crystal_10":10,"pulse":20}},"skarn_2":{"hp":42,"pp":{"atlas_crystal_4":10,"atlas_crystal_7":20,"atlas_crystal_11":15,"pulse":20}},"skarn_3":{"hp":52,"pp":{"atlas_crystal_5":20,"atlas_crystal_8":10,"atlas_crystal_12":15,"dawnstep":15}},"caelum_1":{"hp":33,"pp":{"atlas_wind_4":10,"atlas_wind_7":20,"atlas_wind_11":15,"pulse":20}},"caelum_2":{"hp":43,"pp":{"atlas_wind_5":30,"atlas_wind_8":15,"atlas_wind_12":15,"pulse":20}},"caelum_3":{"hp":53,"pp":{"atlas_wind_6":15,"gust":30,"shelter":15,"dawnstep":15}},"komorizen":{"hp":52,"pp":{"atlas_leaf_4":10,"atlas_leaf_6":15,"bloom":10,"lifeline":20}},"shizunaria":{"hp":54,"pp":{"atlas_tide_4":10,"atlas_tide_6":15,"mist":15,"frost":20}},"akehomura":{"hp":50,"pp":{"atlas_ember_4":10,"atlas_ember_6":15,"warmth":10,"cinder":20}},"arvelion":{"hp":320,"pp":{"arvelion_rend":8,"arvelion_nova":5,"arvelion_crown":3,"arvelion_renewal":5}}});

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const tokenValid = token => typeof token === 'string' && /^(?:[A-Za-z0-9_-]{43}|[a-fA-F0-9]{64})$/.test(token);
const playerView = row => ({id:row.id, name:row.name, isAdmin:!!row.is_admin});
const safeName = value => {
  if (typeof value !== 'string') fail(400, 'INVALID_NAME', 'プレイヤー名を入力してください。');
  const name = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!name || [...name].length > 32) fail(400, 'INVALID_NAME', 'プレイヤー名は1〜32文字で入力してください。');
  return name;
};
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
async function sameSecret(a, b) {
  const x = await digest(a), y = await digest(b);
  let different = 0;
  for (let i = 0; i < x.length; i++) different |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return different === 0;
}
function encodeURL(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decodeURL(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
}
async function signingKey(env) {
  if (typeof env.DUEL_SIGNING_KEY !== 'string' || env.DUEL_SIGNING_KEY.length < 32) fail(503, 'DUEL_NOT_CONFIGURED', 'フートの通信対戦を準備中です。');
  return crypto.subtle.importKey('raw', encoder.encode(env.DUEL_SIGNING_KEY), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
}
function sessionId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value)) fail(400, 'INVALID_SESSION', '対戦の識別情報が正しくありません。');
  return value.toLowerCase();
}
function sideId(value) {
  if (value !== 0 && value !== 1) fail(400, 'INVALID_SIDE', '対戦側の指定が正しくありません。');
  return value;
}
async function verifyPass(env, body) {
  const expectedSession = sessionId(body.sessionId), expectedSide = sideId(body.side), key = await signingKey(env);
  if (typeof body.pass !== 'string' || body.pass.length > 4096) fail(400, 'INVALID_PASS', 'フートの使用証明が正しくありません。');
  try {
    const parts = body.pass.split('.');
    if (parts.length !== 2) throw new Error('Invalid pass');
    const payload = decodeURL(parts[0]), signature = decodeURL(parts[1]);
    if (signature.length !== 32 || !await crypto.subtle.verify('HMAC', key, signature, payload)) throw new Error('Invalid signature');
    const data = JSON.parse(new TextDecoder().decode(payload));
    if (![1,2].includes(data.v) || data.sessionId !== expectedSession || data.side !== expectedSide || !integer(data.expiresAt, Date.now(), Date.now() + 600001) || typeof data.grantId !== 'string') throw new Error('Invalid payload');
    if(data.v===2){
      const owner=await ownerRecord(env);
      if(data.species!=='floravelle'||typeof data.playerId!=='string'||owner?.player_id!==data.playerId||data.grantId!==`admin-mythical:${data.playerId}`)throw new Error('No current owner entitlement');
      return {grantId:data.grantId,species:'floravelle',...MYTHICAL_CONFIG,sessionId:data.sessionId,side:data.side,expiresAt:data.expiresAt};
    }
    return {grantId:data.grantId, species:'futo', ...validateConfig(data.config), sessionId:data.sessionId, side:data.side, expiresAt:data.expiresAt};
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(403, 'INVALID_PASS', 'フートの使用証明が無効、または期限切れです。');
  }
}
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'INVALID_CONFIG', 'フートの能力設定が必要です。');
  if (!integer(input.level, 1, 100)) fail(400, 'INVALID_LEVEL', 'レベルは1〜100にしてください。');
  const stats = {};
  for (const [key, max] of Object.entries(STAT_LIMITS)) {
    const value = input.stats?.[key];
    if (!integer(value, 1, max)) fail(400, 'INVALID_STATS', `${key}は1〜${max}の整数にしてください。`);
    stats[key] = value;
  }
  if (!Array.isArray(input.moves) || input.moves.length !== 4 || new Set(input.moves).size !== 4 || input.moves.some(id => !MOVE_IDS.has(id))) fail(400, 'INVALID_MOVES', '異なる4つの使用可能な技を選んでください。');
  // Upgrade only the original default loadout. Preserve any chosen order or
  // custom move, and leave persisted snapshots/hashes untouched during reads.
  const moves = input.moves.every((id, index) => id === LEGACY_DEFAULT_MOVES[index]) ? DEFAULT_MOVES : input.moves;
  return {level:input.level, stats, moves:[...moves]};
}
async function bodyJSON(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail(415, 'JSON_REQUIRED', 'JSON形式で送信してください。');
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > 16384) fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。');
  const reader = request.body?.getReader();
  let total = 0, chunks = [];
  if (reader) {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16384) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。'); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { fail(400, 'INVALID_JSON', '送信内容を読み取れませんでした。'); }
}
function paging(url, {max = 100, defaultLimit = 50} = {}) {
  const cursor = Number(url.searchParams.get('cursor') || 0), limit = Number(url.searchParams.get('limit') || defaultLimit);
  if (!integer(cursor, 0, Number.MAX_SAFE_INTEGER) || !integer(limit, 1, max)) fail(400, 'INVALID_PAGE', 'ページ指定が正しくありません。');
  return {cursor, limit};
}
async function consumeLimit(env, request, action, max, milliseconds, global = false) {
  const now = Date.now(), bucket = Math.floor(now / milliseconds);
  const identity = global ? 'global' : await digest(request.headers.get('CF-Connecting-IP') || 'unavailable');
  const key = `${action}:${identity}:${bucket}`;
  const row = await env.DB.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(key, (bucket + 1) * milliseconds, max).first();
  if (!row) fail(429, 'RATE_LIMITED', '操作が多すぎます。少し時間をおいてください。');
  // Bounded cleanup of expired counters; no migration-owned table creation here.
  await env.DB.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 20)').bind(now - 86400000).run();
}
async function ownerRecord(env) { return env.DB.prepare('SELECT player_id, claimed_at FROM admin_owner WHERE singleton = 1').first(); }
async function initialCompanions(env, playerId) {
  // This is an owner entitlement, not a distributable grant. Keeping its stable
  // receipt separate from Futo deliveries lets existing administrators receive
  // their initial companion without adding records or replaying gift batches.
  const owner = await ownerRecord(env);
  return owner?.player_id === playerId ? [{grantId:`admin-legendary:${playerId}`, species:'arvelion', level:70}, {grantId:`admin-mythical:${playerId}`,species:'floravelle',level:70}] : [];
}
function recoveryAllowed(env, request, owner) {
  // The configured old owner is the one-time latch: a successful CAS changes
  // that ID, which disables recovery without editing secrets or deleting data.
  return !!owner && typeof env.ADMIN_RECOVERY_OWNER_ID === 'string' &&
    /^P[0-9a-f]{16}$/.test(env.ADMIN_RECOVERY_OWNER_ID) && owner.player_id === env.ADMIN_RECOVERY_OWNER_ID &&
    typeof env.ADMIN_RECOVERY_ORIGIN === 'string' && /^https:\/\/[^/?#]+$/.test(env.ADMIN_RECOVERY_ORIGIN) &&
    request.headers.get('Origin') === env.ADMIN_RECOVERY_ORIGIN;
}
async function adminState(env, request) {
  const owner = await ownerRecord(env);
  return {adminExists:!!owner, adminRecoveryAvailable:recoveryAllowed(env, request, owner)};
}
async function playerByToken(env, token) {
  if (!tokenValid(token)) fail(401, 'UNAUTHORIZED', 'プレイヤー登録をやり直してください。');
  const row = await env.DB.prepare('SELECT p.id, p.name, p.row_id, p.created_at, EXISTS (SELECT 1 FROM admin_owner a WHERE a.player_id = p.id) AS is_admin FROM players p WHERE p.token_hash = ?').bind(await digest(token)).first();
  if (!row) fail(401, 'UNAUTHORIZED', 'プレイヤー登録をやり直してください。');
  return row;
}
async function authenticate(env, request) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
  return playerByToken(env, match?.[1]);
}
async function requireAdmin(env, player) {
  if (!player.is_admin || (await ownerRecord(env))?.player_id !== player.id) fail(403, 'ADMIN_REQUIRED', '運営専用の操作です。');
}
async function configRecord(env) {
  const row = await env.DB.prepare('SELECT config_json, revision FROM futo_config WHERE singleton = 1').first();
  return row ? {config:validateConfig(JSON.parse(row.config_json)), revision:row.revision} : {config:validateConfig(DEFAULT_CONFIG), revision:0};
}
function grantView(row) { return {grantId:row.grant_id, species:'futo', ...validateConfig(JSON.parse(row.config_json)), createdAt:row.created_at}; }
function sameGrantRequest(row, playerId, target, configJSON) {
  return row?.creator_id === playerId && row.target === target && JSON.stringify(validateConfig(JSON.parse(row.config_json))) === configJSON;
}
async function playerGrants(env, playerId, cursor, limit) {
  const result = await env.DB.prepare('SELECT row_id, grant_id, config_json, created_at FROM grants WHERE player_id = ? AND row_id > ? ORDER BY row_id LIMIT ?').bind(playerId, cursor, limit + 1).all();
  const rows = result.results || [];
  return {grants:rows.slice(0, limit).map(grantView), nextCursor:rows.length > limit ? rows[limit - 1].row_id : null};
}

// Trading is a durable two-party exchange of ordinary offline-save snapshots.
// The service verifies their shape and mutual consent, not provenance of offline play.
const TRADE_TTL = 15 * 60 * 1000;
const TRADE_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tradeNicknameSegments = new Intl.Segmenter('ja', {granularity:'grapheme'});
export function validateTradeMonster(input) {
  const allowed = new Set(['uid','species','level','xp','hp','pp','shiny','nickname']);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key)) ||
      !Object.hasOwn(TRADE_SPECIES, input.species) || typeof input.uid !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.uid))
    fail(400, 'INVALID_TRADE_MONSTER', 'このパチモンは交換できません。運営専用・配布個体は対象外です。');
  const species = TRADE_SPECIES[input.species];
  if (!integer(input.level,1,100) || !integer(input.xp,0,input.level===100?0:23+input.level*12) || !integer(input.hp,0,species.hp+input.level*5) ||
      (input.shiny!==undefined && typeof input.shiny!=='boolean') || !input.pp || typeof input.pp!=='object' || Array.isArray(input.pp) ||
      Object.keys(input.pp).length!==Object.keys(species.pp).length || Object.entries(input.pp).some(([key,value]) => !Object.hasOwn(species.pp,key)||!integer(value,0,species.pp[key])))
    fail(400,'INVALID_TRADE_MONSTER','交換するパチモンのレベル・体力・経験値・PPを確認してください。');
  const mon = {uid:input.uid,species:input.species,level:input.level,xp:input.xp,hp:input.hp,pp:Object.fromEntries(Object.keys(species.pp).map(id=>[id,input.pp[id]])),shiny:input.shiny===true};
  if(input.nickname!==undefined){
    if(typeof input.nickname!=='string'||input.nickname.length>160||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(input.nickname))fail(400,'INVALID_TRADE_MONSTER','ニックネームを確認してください。');
    const name=input.nickname.normalize('NFC').trim();
    if([...tradeNicknameSegments.segment(name)].length>5)fail(400,'INVALID_TRADE_MONSTER','ニックネームは5文字までにしてください。');
    if(name)mon.nickname=name;
  }
  return mon;
}
function tradeCode(){return Array.from(crypto.getRandomValues(new Uint8Array(6)),value=>TRADE_CODE[value&31]).join('');}
function tradeRevision(value){if(!integer(value,0,1000000000))fail(400,'INVALID_TRADE_REVISION','交換内容を再確認してください。');return value;}
async function tradeRow(env,id){
  return env.DB.prepare('SELECT t.*, h.name AS host_name, g.name AS guest_name FROM trades t JOIN players h ON h.id=t.host_id LEFT JOIN players g ON g.id=t.guest_id WHERE t.id=?').bind(id).first();
}
async function expireTrade(env,id){
  await env.DB.batch([
    env.DB.prepare("UPDATE trades SET state='expired',host_confirm=NULL,guest_confirm=NULL WHERE id=? AND state='open' AND expires_at<=?").bind(id,Date.now()),
    env.DB.prepare("DELETE FROM trade_active WHERE trade_id=? AND EXISTS (SELECT 1 FROM trades WHERE id=? AND state IN ('cancelled','expired'))").bind(id,id)
  ]);
}
async function activeTrade(env,playerId){
  const active=await env.DB.prepare('SELECT trade_id FROM trade_active WHERE player_id=?').bind(playerId).first();
  if(!active)return null;
  await expireTrade(env,active.trade_id);
  const current=await env.DB.prepare('SELECT trade_id FROM trade_active WHERE player_id=?').bind(playerId).first();
  return current?tradeRow(env,current.trade_id):null;
}
function tradeView(row,playerId){
  const side=row.host_id===playerId?'host':row.guest_id===playerId?'guest':null;
  if(!side)fail(403,'TRADE_PARTICIPANT_REQUIRED','この交換ルームには参加していません。');
  const hostMonster=row.host_offer?JSON.parse(row.host_offer):null,guestMonster=row.guest_offer?JSON.parse(row.guest_offer):null;
  let receipt=null;
  if(row.state==='committed'){
    const outgoing=side==='host'?hostMonster:guestMonster,incoming=side==='host'?guestMonster:hostMonster;
    receipt={id:'trade:'+row.id,outgoingUid:outgoing.uid,outgoing,incoming:{...incoming,uid:'tr-'+row.id+(side==='host'?'-h':'-g')},revision:row.revision};
  }
  return {id:row.id,code:row.code,state:row.state,revision:row.revision,expiresAt:row.expires_at,you:side,
    host:{id:row.host_id,name:row.host_name,monster:hostMonster,confirmed:row.host_confirm===row.revision},
    guest:row.guest_id?{id:row.guest_id,name:row.guest_name,monster:guestMonster,confirmed:row.guest_confirm===row.revision}:null,
    receipt,acknowledged:!!row[side+'_ack']};
}
async function requireTrade(env,id,playerId){
  if(!UUID.test(id))fail(404,'TRADE_NOT_FOUND','交換ルームが見つかりません。');
  let row=await tradeRow(env,id);
  if(!row)fail(404,'TRADE_NOT_FOUND','交換ルームが見つかりません。');
  tradeView(row,playerId); // Verify membership before an otherwise read-only expiry update.
  await expireTrade(env,id);return tradeRow(env,id);
}
function openTrade(row){if(row.state!=='open')fail(409,'TRADE_CLOSED','この交換は終了しています。最新の状態を確認してください。');}
async function tradeRoute(request,env,path,method,player){
  await consumeLimit(env,request,`trade:${player.id}`,180,60000,true);
  if(path==='/api/trades/active'&&method==='GET'){
    const active=await activeTrade(env,player.id);return {trade:active?tradeView(active,player.id):null};
  }
  if(path==='/api/trades'&&method==='POST'){
    const body=await bodyJSON(request);
    if(typeof body.requestId!=='string'||!UUID.test(body.requestId))fail(400,'INVALID_REQUEST_ID','交換の作成情報が正しくありません。');
    const requestId=body.requestId.toLowerCase();
    const prior=await env.DB.prepare('SELECT id FROM trades WHERE host_id=? AND request_id=?').bind(player.id,requestId).first();
    if(prior)return {trade:tradeView(await requireTrade(env,prior.id,player.id),player.id)};
    if(await activeTrade(env,player.id))fail(409,'ACTIVE_TRADE','進行中の交換を先に確認してください。');
    await consumeLimit(env,request,`trade-create:${player.id}`,20,3600000,true);
    for(let attempt=0;attempt<5;attempt++){
      const id=crypto.randomUUID(),now=Date.now();
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO trades (id,code,request_id,host_id,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM trade_active WHERE player_id=?)").bind(id,tradeCode(),requestId,player.id,now,now+TRADE_TTL,player.id),
        env.DB.prepare('INSERT OR IGNORE INTO trade_active (player_id,trade_id) SELECT host_id,id FROM trades WHERE id=?').bind(id)
      ]);
      const created=await env.DB.prepare('SELECT id FROM trades WHERE host_id=? AND request_id=?').bind(player.id,requestId).first();
      if(created)return {trade:tradeView(await tradeRow(env,created.id),player.id)};
      if(await activeTrade(env,player.id))fail(409,'ACTIVE_TRADE','進行中の交換を先に確認してください。');
    }
    fail(503,'TRADE_CODE_BUSY','ルームを作成できませんでした。少し待って再試行してください。');
  }
  if(path==='/api/trades/join'&&method==='POST'){
    const body=await bodyJSON(request),code=typeof body.code==='string'?body.code.trim().toUpperCase():'';
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))fail(400,'INVALID_TRADE_CODE','6文字の交換コードを入力してください。');
    await consumeLimit(env,request,`trade-join:${player.id}`,30,60000,true);
    await consumeLimit(env,request,'trade-join-ip',60,60000);
    const found=await env.DB.prepare('SELECT id FROM trades WHERE code=?').bind(code).first();
    if(!found)fail(404,'TRADE_NOT_FOUND','交換ルームが見つかりません。');
    await expireTrade(env,found.id);
    const row=await tradeRow(env,found.id);
    if(row.host_id===player.id||row.guest_id===player.id)return {trade:tradeView(row,player.id)};
    openTrade(row);
    if(row.guest_id)fail(409,'TRADE_FULL','交換ルームは満員です。');
    if(await activeTrade(env,player.id))fail(409,'ACTIVE_TRADE','進行中の交換を先に確認してください。');
    await env.DB.batch([
      env.DB.prepare("UPDATE trades SET guest_id=?,revision=revision+1,host_confirm=NULL,guest_confirm=NULL WHERE id=? AND state='open' AND guest_id IS NULL AND expires_at>? AND NOT EXISTS (SELECT 1 FROM trade_active WHERE player_id=?)").bind(player.id,row.id,Date.now(),player.id),
      env.DB.prepare('INSERT OR IGNORE INTO trade_active (player_id,trade_id) SELECT guest_id,id FROM trades WHERE id=? AND guest_id=?').bind(row.id,player.id)
    ]);
    const joined=await tradeRow(env,row.id);
    if(joined.guest_id!==player.id)fail(409,'TRADE_UNAVAILABLE','ルームの状態が変わりました。コードを確認してください。');
    return {trade:tradeView(joined,player.id)};
  }
  const match=/^\/api\/trades\/([0-9a-f-]+)(?:\/(offer|confirm|cancel|ack))?$/.exec(path);
  if(!match)fail(404,'NOT_FOUND','この交換操作はありません。');
  const [,id,operation]=match;let row=await requireTrade(env,id,player.id);const side=row.host_id===player.id?'host':'guest';
  if(!operation&&method==='GET')return {trade:tradeView(row,player.id)};
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','この操作にはPOSTを使用してください。');
  const body=await bodyJSON(request);
  if(operation==='ack'){
    if(row.state==='open')fail(409,'TRADE_NOT_COMPLETE','交換はまだ確定していません。');
    await env.DB.batch([
      env.DB.prepare(`UPDATE trades SET ${side}_ack=1 WHERE id=? AND state='committed'`).bind(id),
      env.DB.prepare("DELETE FROM trade_active WHERE player_id=? AND trade_id=? AND EXISTS (SELECT 1 FROM trades WHERE id=? AND state<>'open')").bind(player.id,id,id)
    ]);
  }else if(operation==='cancel'){
    await env.DB.batch([
      env.DB.prepare("UPDATE trades SET state='cancelled',host_confirm=NULL,guest_confirm=NULL WHERE id=? AND state='open'").bind(id),
      env.DB.prepare("DELETE FROM trade_active WHERE trade_id=? AND EXISTS (SELECT 1 FROM trades WHERE id=? AND state IN ('cancelled','expired'))").bind(id,id)
    ]);
  }else if(operation==='offer'){
    openTrade(row);const revision=tradeRevision(body.revision),monster=JSON.stringify(validateTradeMonster(body.monster));
    if(row[side+'_offer']===monster)return {trade:tradeView(row,player.id)};
    await env.DB.prepare(`UPDATE trades SET ${side}_offer=?,revision=revision+1,host_confirm=NULL,guest_confirm=NULL WHERE id=? AND revision=? AND state='open' AND expires_at>?`).bind(monster,id,revision,Date.now()).run();
    row=await tradeRow(env,id);
    if(row.state!=='open'||row[side+'_offer']!==monster)fail(409,'TRADE_CHANGED','交換内容が変わりました。両方のパチモンを再確認してください。');
  }else if(operation==='confirm'){
    const revision=tradeRevision(body.revision);
    if(row.state==='committed')return {trade:tradeView(row,player.id)};
    openTrade(row);
    if(!row.host_offer||!row.guest_offer||!row.guest_id)fail(409,'TRADE_INCOMPLETE','お互いのパチモンがそろうまで待ってください。');
    if(row.revision!==revision)fail(409,'TRADE_CHANGED','交換内容が変わりました。両方のパチモンを再確認してください。');
    await env.DB.batch([
      env.DB.prepare(`UPDATE trades SET ${side}_confirm=revision WHERE id=? AND revision=? AND state='open' AND expires_at>?`).bind(id,revision,Date.now()),
      env.DB.prepare("UPDATE trades SET state='committed',committed_at=? WHERE id=? AND state='open' AND expires_at>? AND guest_id IS NOT NULL AND host_offer IS NOT NULL AND guest_offer IS NOT NULL AND host_confirm=revision AND guest_confirm=revision").bind(Date.now(),id,Date.now())
    ]);
    row=await tradeRow(env,id);
    if(row.state!=='committed'&&(row.state!=='open'||row.revision!==revision))fail(409,'TRADE_CHANGED','交換内容が変わりました。最新の状態を確認してください。');
  }else fail(404,'NOT_FOUND','この交換操作はありません。');
  return {trade:tradeView(await tradeRow(env,id),player.id)};
}

async function route(request, env, url) {
  const path = url.pathname.replace(/\/$/, '') || '/', method = request.method;
  if (path === '/api/status' && method === 'GET') return adminState(env, request);
  if (path === '/api/register' && method === 'POST') {
    const body = await bodyJSON(request), name = safeName(body.name), token = body.token;
    if (!tokenValid(token)) fail(400, 'INVALID_TOKEN', '安全なプレイヤー識別情報を生成できませんでした。');
    const hash = await digest(token);
    const existing = await env.DB.prepare('SELECT id FROM players WHERE token_hash = ?').bind(hash).first();
    if (!existing) {
      await consumeLimit(env, request, 'register', 30, 3600000);
      const id = `P${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, now = Date.now();
      await env.DB.prepare('INSERT OR IGNORE INTO players (id, token_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, hash, name, now, now).run();
    }
    return {player:playerView(await playerByToken(env, token)), ...await adminState(env, request)};
  }
  if (path === '/api/duel-pass/verify' && method === 'POST') {
    await consumeLimit(env, request, 'duel-verify', 120, 60000);
    return verifyPass(env, await bodyJSON(request));
  }
  const player = await authenticate(env, request);
  if(path==='/api/trades'||path.startsWith('/api/trades/'))return tradeRoute(request,env,path,method,player);
  if (path === '/api/me' && method === 'GET') {
    const {cursor, limit} = paging(url);
    return {player:playerView(player), ...await adminState(env, request), ...await playerGrants(env, player.id, cursor, limit), initialCompanions:await initialCompanions(env, player.id)};
  }
  if (path === '/api/me' && method === 'PATCH') {
    const name = safeName((await bodyJSON(request)).name);
    await consumeLimit(env, request, `rename:${player.id}`, 30, 60000, true);
    await env.DB.prepare('UPDATE players SET name = ?, updated_at = ? WHERE id = ?').bind(name, Date.now(), player.id).run();
    return {player:{...playerView(player), name}, ...await adminState(env, request)};
  }
  if (path === '/api/duel-pass' && method === 'POST') {
    const body = await bodyJSON(request), session = sessionId(body.sessionId), side = sideId(body.side);
    if (typeof body.grantId !== 'string' || body.grantId.length > 100) fail(400, 'INVALID_GRANT', 'フートの受取記録を指定してください。');
    await consumeLimit(env, request, `duel-issue:${player.id}`, 30, 60000, true);
    if(body.grantId.startsWith('admin-mythical:')){
      const owner=await ownerRecord(env);
      if(owner?.player_id!==player.id||body.grantId!==`admin-mythical:${player.id}`)fail(403,'GRANT_NOT_OWNED','この幻パチモンは現在の運営だけが使用できます。');
      const expiresAt=Date.now()+600000;
      const payload=encoder.encode(JSON.stringify({v:2,species:'floravelle',playerId:player.id,grantId:body.grantId,sessionId:session,side,expiresAt}));
      const signature=new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env),payload));
      return {pass:`${encodeURL(payload)}.${encodeURL(signature)}`,expiresAt};
    }
    const grant = await env.DB.prepare('SELECT grant_id, config_json FROM grants WHERE player_id = ? AND grant_id = ?').bind(player.id, body.grantId).first();
    if (!grant) fail(403, 'GRANT_NOT_OWNED', 'このフートの受取記録を確認できません。');
    const expiresAt = Date.now() + 600000;
    const payload = encoder.encode(JSON.stringify({v:1, sessionId:session, side, grantId:grant.grant_id, config:validateConfig(JSON.parse(grant.config_json)), expiresAt}));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), payload));
    return {pass:`${encodeURL(payload)}.${encodeURL(signature)}`, expiresAt};
  }
  if (path === '/api/admin/claim' && method === 'POST') {
    const previousOwner = await ownerRecord(env), configured = recoveryAllowed(env, request, previousOwner);
    if (previousOwner?.player_id === player.id) return {player:{...playerView(player), isAdmin:true}, ...await adminState(env, request), ...await playerGrants(env, player.id, 0, 100), initialCompanions:await initialCompanions(env, player.id)};
    // Explicit recovery requests retain the existing operator-key recovery API.
    // The recovery request works with or without ADMIN_RECOVERY_* settings: the operator key,
    // player authentication and the rate limits below still decide. Ordinary claims still stop
    // at an existing operator.
    const early = previousOwner && !configured ? await bodyJSON(request) : null;
    const recovering = configured || (!!previousOwner && early?.recover === true);
    if (previousOwner && !recovering) fail(409, 'ADMIN_ALREADY_EXISTS', '運営はすでに登録されています。');
    if (typeof env.ADMIN_CLAIM_KEY !== 'string' || env.ADMIN_CLAIM_KEY.length < 12) fail(503, 'ADMIN_NOT_CONFIGURED', '運営登録は準備中です。');
    await consumeLimit(env, request, 'claim-ip', 8, 900000);
    await consumeLimit(env, request, 'claim-global', 100, 900000, true);
    const body = early || await bodyJSON(request);
    if (typeof body.key !== 'string' || body.key.length > 256 || !await sameSecret(body.key, env.ADMIN_CLAIM_KEY)) fail(403, 'INVALID_ADMIN_KEY', '運営キーが正しくありません。');
    const now = Date.now(), config = JSON.stringify((await configRecord(env)).config);
    const batchId = recovering ? `admin-recovery:${previousOwner.player_id}:${player.id}` : `admin-initial:${player.id}`;
    const payloadHash = await digest(config);
    const claimOwner = recovering ?
      env.DB.prepare('UPDATE admin_owner SET player_id = ?, claimed_at = ? WHERE singleton = 1 AND player_id = ?').bind(player.id, now, previousOwner.player_id) :
      env.DB.prepare('INSERT OR IGNORE INTO admin_owner (singleton, player_id, claimed_at) VALUES (1, ?, ?)').bind(player.id, now);
    await env.DB.batch([
      claimOwner,
      env.DB.prepare('INSERT OR IGNORE INTO futo_config (singleton, config_json, revision, updated_at) SELECT 1, ?, 1, ? WHERE EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)').bind(config, now, player.id),
      env.DB.prepare('INSERT OR IGNORE INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) SELECT ?, ?, ?, ?, config_json, ?, ? FROM futo_config WHERE singleton = 1 AND EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)').bind(batchId, player.id, player.id, payloadHash, player.row_id, now, player.id),
      env.DB.prepare('INSERT INTO grants (grant_id, batch_id, player_id, config_json, created_at) SELECT ?, ?, ?, config_json, ? FROM futo_config WHERE singleton = 1 AND EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?) ON CONFLICT(grant_id) DO UPDATE SET config_json = excluded.config_json').bind(`admin-initial:${player.id}`, batchId, player.id, now, player.id)
    ]);
    const owner = await ownerRecord(env);
    if (owner?.player_id !== player.id) fail(409, 'ADMIN_ALREADY_EXISTS', '運営はすでに登録されています。');
    return {player:{...playerView(player), isAdmin:true}, ...await adminState(env, request), ...await playerGrants(env, player.id, 0, 100), initialCompanions:await initialCompanions(env, player.id)};
  }
  await requireAdmin(env, player);
  if (path === '/api/admin/config' && method === 'GET') {
    const owner = await ownerRecord(env);
    if (owner?.player_id !== player.id) fail(403, 'ADMIN_REQUIRED', '運営専用の操作です。');
    return {...await configRecord(env), adminRegistration:{playerId:owner.player_id, claimedAt:owner.claimed_at}};
  }
  if (path === '/api/admin/release' && method === 'POST') {
    const body = await bodyJSON(request), expected = body.expectedRegistration;
    if (body.confirmed !== true || expected?.playerId !== player.id || !Number.isSafeInteger(expected?.claimedAt) || expected.claimedAt < 0) {
      fail(400, 'RELEASE_CONFIRMATION_REQUIRED', '運営登録の解除内容を確認してから操作してください。');
    }
    // Delete only the exact registration reviewed by the current owner. A
    // delayed request must never release a replacement administrator.
    const removed = await env.DB.prepare('DELETE FROM admin_owner WHERE singleton = 1 AND player_id = ? AND claimed_at = ? RETURNING player_id').bind(player.id, expected.claimedAt).first();
    if (!removed) fail(409, 'ADMIN_REGISTRATION_CHANGED', '運営登録が変更されています。最新の状態を確認してください。');
    // Keep player identities, configuration and delivered gifts intact.
    const currentOwner = await ownerRecord(env);
    return {released:true, player:{...playerView(player), isAdmin:currentOwner?.player_id === player.id}, adminExists:!!currentOwner, adminRecoveryAvailable:recoveryAllowed(env, request, currentOwner)};
  }
  if (path === '/api/admin/config' && method === 'PUT') {
    const body = await bodyJSON(request), config = validateConfig(body.config), current = await configRecord(env);
    if (body.expectedRevision !== undefined && body.expectedRevision !== current.revision) fail(409, 'CONFIG_CHANGED', '設定が変更されています。再読み込みしてください。');
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE futo_config SET config_json = ?, revision = revision + 1, updated_at = ? WHERE singleton = 1 AND revision = ? AND EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?) RETURNING revision').bind(JSON.stringify(config), Date.now(), current.revision, player.id),
      env.DB.prepare("UPDATE grants SET config_json = (SELECT config_json FROM futo_config WHERE singleton = 1) WHERE grant_id = ? AND player_id = ? AND EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)").bind(`admin-initial:${player.id}`, player.id, player.id)
    ]);
    const result = results[0]?.results?.[0];
    if (!result) { await requireAdmin(env, player); fail(409, 'CONFIG_CHANGED', '設定が変更されています。再読み込みしてください。'); }
    return {config, revision:result.revision};
  }
  if (path === '/api/admin/players' && method === 'GET') {
    const {cursor, limit} = paging(url);
    const result = await env.DB.prepare('SELECT p.row_id, p.id, p.name, p.created_at, EXISTS (SELECT 1 FROM admin_owner a WHERE a.player_id = p.id) AS is_admin FROM players p WHERE p.row_id > ? ORDER BY p.row_id LIMIT ?').bind(cursor, limit + 1).all();
    const rows = result.results || [];
    return {players:rows.slice(0, limit).map(row => ({...playerView(row), createdAt:row.created_at})), nextCursor:rows.length > limit ? rows[limit - 1].row_id : null};
  }
  if (path === '/api/admin/grants' && method === 'POST') {
    const body = await bodyJSON(request);
    if (body.species !== undefined && body.species !== 'futo') fail(400, 'SPECIES_NOT_DISTRIBUTABLE', '配布できるパチモンはフートだけです。');
    if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) fail(400, 'INVALID_REQUEST_ID', '配布操作の識別情報が正しくありません。');
    let target = body.target === 'self' ? player.id : body.target;
    if (target !== 'all' && (typeof target !== 'string' || !/^P[0-9a-f]{16}$/.test(target))) fail(400, 'INVALID_TARGET', '配布先を選択してください。');
    if (target !== 'all' && !await env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(target).first()) fail(404, 'PLAYER_NOT_FOUND', '配布先のプレイヤーが見つかりません。');
    const batchId = body.requestId.toLowerCase();
    const existing = await env.DB.prepare('SELECT payload_hash, creator_id, target, config_json FROM grant_batches WHERE id = ?').bind(batchId).first();
    // A retry that omitted config still means its original stored snapshot,
    // even if the administrator has changed the current defaults since then.
    const config = validateConfig(body.config || (existing ? JSON.parse(existing.config_json) : (await configRecord(env)).config)), configJSON = JSON.stringify(config);
    const payloadHash = await digest(JSON.stringify({target, config}));
    if (existing && !sameGrantRequest(existing, player.id, target, configJSON)) fail(409, 'REQUEST_ID_REUSED', '配布識別情報が別の操作に使われています。');
    // A legacy batch may have an older hash for the same effective loadout.
    // Retain that hash and its recipient cutoff so retries neither conflict nor
    // distribute a second gift to players who registered after first issuance.
    const storedHash = existing?.payload_hash || payloadHash;
    if (!existing) await consumeLimit(env, request, 'grant-global', 60, 60000, true);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) SELECT ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(row_id), 0) FROM players), ? WHERE EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)').bind(batchId, player.id, target, payloadHash, configJSON, Date.now(), player.id),
      env.DB.prepare("INSERT OR IGNORE INTO grants (grant_id, batch_id, player_id, config_json, created_at) SELECT b.id || ':' || p.id, b.id, p.id, b.config_json, b.created_at FROM grant_batches b JOIN players p ON p.row_id <= b.max_player_row AND (b.target = 'all' OR b.target = p.id) WHERE b.id = ? AND b.payload_hash = ? AND b.creator_id = ? AND EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)").bind(batchId, storedHash, player.id, player.id)
    ]);
    await requireAdmin(env, player);
    const actual = await env.DB.prepare('SELECT payload_hash, creator_id, target, config_json FROM grant_batches WHERE id = ?').bind(batchId).first();
    if (!sameGrantRequest(actual, player.id, target, configJSON)) fail(409, 'REQUEST_ID_REUSED', '配布識別情報が別の操作に使われています。');
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM grants WHERE batch_id = ?').bind(batchId).first();
    return {batchId, recipientCount:count.total, replayed:!!existing};
  }
  fail(404, 'NOT_FOUND', 'この操作はありません。');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const allowed = new Set([BASE_ORIGIN, url.origin, ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
    const headers = new Headers({'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Vary':'Origin'});
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), {status, headers});
    if (origin && !allowed.has(origin)) return json({ok:false, error:{code:'ORIGIN_DENIED', message:'この送信元は許可されていません。'}}, 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      headers.set('Access-Control-Max-Age', '600');
      return new Response(null, {status:204, headers});
    }
    if (url.pathname === '/' && request.method === 'GET') {
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>パチモン通信サービス</title><style>body{font:18px system-ui;max-width:40rem;margin:12vh auto;padding:2rem;color:#17283e;background:#fffdf8}a{color:#238978}</style><h1>パチモン通信サービス</h1><p>運営登録とフートの配布を同期するサービスです。</p><a href="https://uni-tadayasu.github.io/pachi-mon/">パチモンを開く</a></html>', {headers});
    }
    try {
      if (!env.DB) fail(503, 'DATABASE_UNAVAILABLE', '通信サービスを準備中です。');
      return json({ok:true, ...await route(request, env, url)});
    } catch (error) {
      if (error instanceof ApiError) return json({ok:false, error:{code:error.code, message:error.message}}, error.status);
      console.error('Pachi API request failed', error?.name || 'Error');
      return json({ok:false, error:{code:'INTERNAL_ERROR', message:'通信処理に失敗しました。時間をおいて再試行してください。'}}, 500);
    }
  }
};
