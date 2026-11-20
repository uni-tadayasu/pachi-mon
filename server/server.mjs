// Pachi Monsters shared ownership and Futo delivery API.
// ADMIN_CLAIM_KEY is a runtime secret. Never place it in client code or source.
import {RULES_VERSION as KASAI_RULES_VERSION,LEGACY_RULES_VERSION as KASAI_LEGACY_RULES_VERSION,MAX_ACTIONS as KASAI_MAX_ACTIONS,KASAI_TEAM,normalizeParty as normalizeKasaiParty,replayChallenge} from './kasai-replay.mjs';
import {createLiveBattle,validateLiveOrders,resolveLiveRound} from './kasai-live-engine.mjs';
import {rankedRoute,hasRankedMembership} from './ranked-service.mjs';
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
const adminRole = seat => seat === 3 ? 'sub-sub' : seat === 2 ? 'sub' : seat ? 'main' : null;
const ADMIN_DISPLAY_NAMES = Object.freeze({main:'謎のトレーナー カサイ',sub:'サカイ','sub-sub':'イサカ'});
const adminDisplayName = (name, seat) => ADMIN_DISPLAY_NAMES[adminRole(seat)] || name;
// Keep the registered name separate from a role's character name. Appointing,
// renaming or dismissing an administrator never overwrites their ordinary identity.
const playerView = row => ({id:row.id, name:row.name, displayName:adminDisplayName(row.name,row.is_admin), isAdmin:!!row.is_admin, adminRole:adminRole(row.is_admin)});
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
    if (![1,2,3].includes(data.v) || data.sessionId !== expectedSession || data.side !== expectedSide || !integer(data.expiresAt, Date.now(), Date.now() + 600001) || typeof data.grantId !== 'string') throw new Error('Invalid payload');
    if(data.v===3){
      if(data.species!=='floravelle'||typeof data.playerId!=='string'||!/^P[0-9a-f]{16}$/.test(data.playerId)||data.grantId!==`kasai-reward:${data.playerId}`||!await env.DB.prepare('SELECT player_id FROM kasai_rewards WHERE player_id=? AND receipt_id=?').bind(data.playerId,data.grantId).first())throw new Error('No earned reward entitlement');
      return {grantId:data.grantId,species:'floravelle',...MYTHICAL_CONFIG,sessionId:data.sessionId,side:data.side,expiresAt:data.expiresAt};
    }
    if(data.v===2){
      if(data.species!=='floravelle'||typeof data.playerId!=='string'||!await adminRecord(env,data.playerId)||data.grantId!==`admin-mythical:${data.playerId}`)throw new Error('No current administrator entitlement');
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
async function ownerRecord(env) { return env.DB.prepare('SELECT singleton, player_id, claimed_at FROM admin_members ORDER BY singleton LIMIT 1').first(); }
async function adminRecord(env, playerId) { return env.DB.prepare('SELECT singleton, player_id, claimed_at FROM admin_members WHERE player_id = ?').bind(playerId).first(); }
const adminTable = record => record.singleton === 3 ? 'third_admin_owner' : record.singleton === 2 ? 'sub_admin_owner' : 'admin_owner';
function nextAdminRegistration(env, now, guard = '1', values = [], operationId = crypto.randomUUID()) {
  // The clock survives release. A second registration of the same player is
  // distinguishable even when two operations share a millisecond timestamp.
  return env.DB.prepare(`INSERT INTO admin_registration_clock (singleton, claimed_at, operation_id)
    SELECT 1, MAX(?, COALESCE((SELECT MAX(claimed_at) + 1 FROM admin_members), 0)), ? WHERE ${guard}
    ON CONFLICT(singleton) DO UPDATE SET claimed_at = MAX(admin_registration_clock.claimed_at + 1, excluded.claimed_at), operation_id = excluded.operation_id`)
    .bind(now, operationId, ...values);
}
async function adminDevices(env, playerId) {
  const result = await env.DB.prepare('SELECT a.singleton, a.player_id, a.claimed_at, p.name FROM admin_members a JOIN players p ON p.id = a.player_id ORDER BY a.singleton').all();
  return {devices:result.results.map(row => ({playerId:row.player_id, name:row.name, displayName:adminDisplayName(row.name,row.singleton), role:adminRole(row.singleton), claimedAt:row.claimed_at})), capacity:3,
    canManageDevices:result.results.some(row => row.singleton === 1 && row.player_id === playerId)};
}
function adminPlayerId(value) {
  if (typeof value !== 'string' || !/^P[0-9a-f]{16}$/.test(value)) fail(400, 'INVALID_PLAYER_ID', 'プレイヤーIDを確認してください。');
  return value;
}
async function recoveryOwner(env) {
  return typeof env.ADMIN_RECOVERY_OWNER_ID === 'string' && /^P[0-9a-f]{16}$/.test(env.ADMIN_RECOVERY_OWNER_ID) ? adminRecord(env, env.ADMIN_RECOVERY_OWNER_ID) : null;
}
async function initialCompanions(env, playerId) {
  // This is a current administrator entitlement, not a distributable grant. Keeping its stable
  // receipt separate from Futo deliveries lets existing administrators receive
  // their initial companion without adding records or replaying gift batches.
  const registration=await adminRecord(env,playerId);
  return registration&&registration.singleton!==2 ? [{grantId:`admin-legendary:${playerId}`, species:'arvelion', level:70}, {grantId:`admin-mythical:${playerId}`,species:'floravelle',level:70}] : [];
}
const ADMIN_RESERVE_STARTERS = Object.freeze({main:'komorizen',sub:'shizunaria','sub-sub':'akehomura'});
const ADMIN_RESERVE_COMMON = Object.freeze(['floravelle','zeroveil','pearlseria','hyogald','rurigorm']);
async function adminReserveTeam(env, playerId, {delivery=true}={}) {
  const registration=await adminRecord(env,playerId),role=adminRole(registration?.singleton);
  if(!role||delivery&&role==='sub')return null;
  // A deterministic current-role entitlement is independent of the gift inbox.
  // Stable member receipts let the client restore only missing individuals;
  // reading or restoring it never creates another Futo distribution batch.
  const gender=role==='sub'?'female':'male';
  return {version:1,playerId,role,members:[ADMIN_RESERVE_STARTERS[role],...ADMIN_RESERVE_COMMON].map(species=>({
    grantId:`admin-trained-v64:${role}:${playerId}:${species}`,species,level:100,gender,heldItem:'trainband',bonusPoints:99,battleGrowth:99
  }))};
}
async function adminReserveAddition(env, playerId, {delivery=true}={}) {
  const registration=await adminRecord(env,playerId),role=adminRole(registration?.singleton);
  if(!role||delivery&&role==='sub')return null;
  // A separate receipt never reissues or rewrites the six v64 members.
  // Keep the historical v68 entitlement ID so old receipts suppress a second delivery.
  return {version:2,playerId,role,members:[{grantId:`admin-galdogran-v68:${role}:${playerId}:galdogran`,species:'lunaxion',level:100,gender:'none',heldItem:'trainband',bonusPoints:99}]};
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
  const owner = await ownerRecord(env), recoverable = await recoveryOwner(env);
  return {adminExists:!!owner, adminRecoveryAvailable:recoveryAllowed(env, request, recoverable)};
}
async function playerByToken(env, token) {
  if (!tokenValid(token)) fail(401, 'UNAUTHORIZED', 'プレイヤー登録をやり直してください。');
  const row = await env.DB.prepare('SELECT p.id, p.name, p.row_id, p.created_at, (SELECT a.singleton FROM admin_members a WHERE a.player_id=p.id) AS is_admin FROM players p WHERE p.token_hash = ?').bind(await digest(token)).first();
  if (!row) fail(401, 'UNAUTHORIZED', 'プレイヤー登録をやり直してください。');
  return row;
}
async function authenticate(env, request) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
  return playerByToken(env, match?.[1]);
}
async function requireAdmin(env, player) {
  const registration = await adminRecord(env, player.id);
  if (!player.is_admin || !registration) fail(403, 'ADMIN_REQUIRED', '運営専用の操作です。');
  return registration;
}
function requireMainAdmin(registration) {
  if (registration.singleton !== 1) fail(403, 'MAIN_ADMIN_REQUIRED', 'サブ運営・サブサブ運営の追加・解雇はメイン運営だけが操作できます。');
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
  // Old clients also read this inbox. Hide even previously queued automatic
  // Futo grants from a current sub administrator, but retain the rows as proof
  // for already-owned individuals. Explicit manual gift batches stay visible.
  const result = await env.DB.prepare(`SELECT row_id, grant_id, config_json, created_at FROM grants WHERE player_id = ? AND row_id > ?
    AND (grant_id <> 'admin-initial:' || player_id OR NOT EXISTS (SELECT 1 FROM admin_members a WHERE a.player_id=grants.player_id AND a.singleton=2))
    ORDER BY row_id LIMIT ?`).bind(playerId, cursor, limit + 1).all();
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
  const allowed = new Set(['uid','species','level','xp','hp','pp','shiny','nickname','battleGrowth']);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key)) ||
      !Object.hasOwn(TRADE_SPECIES, input.species) || typeof input.uid !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.uid))
    fail(400, 'INVALID_TRADE_MONSTER', 'このパチモンは交換できません。運営専用・配布個体は対象外です。');
  const species = TRADE_SPECIES[input.species];
  const battleGrowth=input.battleGrowth===undefined?0:input.battleGrowth;
  if(!integer(input.level,1,100)||!integer(battleGrowth,0,Math.min(99,input.level-1)))
    fail(400,'INVALID_TRADE_MONSTER','交換するパチモンの戦闘で育った能力を確認してください。');
  if (!integer(input.xp,0,input.level===100?0:23+input.level*12) || !integer(input.hp,0,species.hp+input.level*5+battleGrowth*2) ||
      (input.shiny!==undefined && typeof input.shiny!=='boolean') || !input.pp || typeof input.pp!=='object' || Array.isArray(input.pp) ||
      Object.keys(input.pp).length!==Object.keys(species.pp).length || Object.entries(input.pp).some(([key,value]) => !Object.hasOwn(species.pp,key)||!integer(value,0,species.pp[key])))
    fail(400,'INVALID_TRADE_MONSTER','交換するパチモンのレベル・体力・経験値・PPを確認してください。');
  const mon = {uid:input.uid,species:input.species,level:input.level,xp:input.xp,hp:input.hp,pp:Object.fromEntries(Object.keys(species.pp).map(id=>[id,input.pp[id]])),shiny:input.shiny===true};
  // Omit the zero default so unchanged individuals remain compatible with
  // legacy trade envelopes, while positive earned growth survives receipts.
  if(battleGrowth)mon.battleGrowth=battleGrowth;
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
  return env.DB.prepare(`SELECT t.*, h.name AS host_name, g.name AS guest_name,
    (SELECT a.singleton FROM admin_members a WHERE a.player_id=t.host_id) AS host_admin,
    (SELECT a.singleton FROM admin_members a WHERE a.player_id=t.guest_id) AS guest_admin
    FROM trades t JOIN players h ON h.id=t.host_id LEFT JOIN players g ON g.id=t.guest_id WHERE t.id=?`).bind(id).first();
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
    host:{id:row.host_id,name:adminDisplayName(row.host_name,row.host_admin),monster:hostMonster,confirmed:row.host_confirm===row.revision},
    guest:row.guest_id?{id:row.guest_id,name:adminDisplayName(row.guest_name,row.guest_admin),monster:guestMonster,confirmed:row.guest_confirm===row.revision}:null,
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
    if(await hasRankedMembership(env,player.id))fail(409,'RANKED_BUSY','ランク対戦を終了してから交換してください。');
    await consumeLimit(env,request,`trade-create:${player.id}`,20,3600000,true);
    for(let attempt=0;attempt<5;attempt++){
      const id=crypto.randomUUID(),now=Date.now();
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO trades (id,code,request_id,host_id,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM trade_active WHERE player_id=?) AND NOT EXISTS (SELECT 1 FROM ranked_members WHERE player_id=?)").bind(id,tradeCode(),requestId,player.id,now,now+TRADE_TTL,player.id,player.id),
        env.DB.prepare('INSERT OR IGNORE INTO trade_active (player_id,trade_id) SELECT host_id,id FROM trades WHERE id=?').bind(id)
      ]);
      const created=await env.DB.prepare('SELECT id FROM trades WHERE host_id=? AND request_id=?').bind(player.id,requestId).first();
      if(created)return {trade:tradeView(await tradeRow(env,created.id),player.id)};
      if(await activeTrade(env,player.id))fail(409,'ACTIVE_TRADE','進行中の交換を先に確認してください。');
      if(await hasRankedMembership(env,player.id))fail(409,'RANKED_BUSY','ランク対戦を終了してから交換してください。');
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
    if(row.world_guest_id) {
      if(row.world_guest_id!==player.id)fail(403,'TRADE_RESERVED','この交換ルームは、フィールドで誘われたプレイヤー専用です。');
      const invitation=await env.DB.prepare("SELECT id FROM world_invitations WHERE kind='trade' AND room_code=? AND sender_id=? AND target_id=? AND state='accepted'").bind(code,row.host_id,player.id).first();
      if(!invitation)fail(409,'WORLD_INVITATION_REQUIRED','フィールドのお誘いで「参加する」を選んでください。');
    }
    if(await activeTrade(env,player.id))fail(409,'ACTIVE_TRADE','進行中の交換を先に確認してください。');
    if(await hasRankedMembership(env,player.id))fail(409,'RANKED_BUSY','ランク対戦を終了してから交換してください。');
    await env.DB.batch([
      env.DB.prepare("UPDATE trades SET guest_id=?,revision=revision+1,host_confirm=NULL,guest_confirm=NULL WHERE id=? AND state='open' AND guest_id IS NULL AND expires_at>? AND NOT EXISTS (SELECT 1 FROM trade_active WHERE player_id=?) AND NOT EXISTS (SELECT 1 FROM ranked_members WHERE player_id=?)").bind(player.id,row.id,Date.now(),player.id,player.id),
      env.DB.prepare('INSERT OR IGNORE INTO trade_active (player_id,trade_id) SELECT guest_id,id FROM trades WHERE id=? AND guest_id=?').bind(row.id,player.id)
    ]);
    const joined=await tradeRow(env,row.id);
    if(joined.guest_id!==player.id&&await hasRankedMembership(env,player.id))fail(409,'RANKED_BUSY','ランク対戦を終了してから交換してください。');
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
    const waitingOnly=body.waitingOnly===true;
    if(waitingOnly&&side!=='host')fail(403,'TRADE_HOST_REQUIRED','待機中のルームを閉じられるのは作成した人だけです。');
    const expectedRevision=waitingOnly?tradeRevision(body.expectedRevision):null;
    await env.DB.batch([
      env.DB.prepare("UPDATE trades SET state='cancelled',host_confirm=NULL,guest_confirm=NULL WHERE id=? AND state='open'"+(waitingOnly?' AND host_id=? AND guest_id IS NULL AND revision=?':'')).bind(id,...(waitingOnly?[player.id,expectedRevision]:[])),
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
    if([row.host_offer,row.guest_offer].some(offer=>JSON.parse(offer).battleGrowth>0)&&body.supportsBattleGrowth!==true)
      fail(409,'TRADE_CLIENT_UPDATE_REQUIRED','戦闘で育った能力を保って交換するため、両方の端末でページを更新してから確認してください。');
    await env.DB.batch([
      env.DB.prepare(`UPDATE trades SET ${side}_confirm=revision WHERE id=? AND revision=? AND state='open' AND expires_at>?`).bind(id,revision,Date.now()),
      env.DB.prepare("UPDATE trades SET state='committed',committed_at=? WHERE id=? AND state='open' AND expires_at>? AND guest_id IS NOT NULL AND host_offer IS NOT NULL AND guest_offer IS NOT NULL AND host_confirm=revision AND guest_confirm=revision").bind(Date.now(),id,Date.now())
    ]);
    row=await tradeRow(env,id);
    if(row.state!=='committed'&&(row.state!=='open'||row.revision!==revision))fail(409,'TRADE_CHANGED','交換内容が変わりました。最新の状態を確認してください。');
  }else fail(404,'NOT_FOUND','この交換操作はありません。');
  return {trade:tradeView(await tradeRow(env,id),player.id)};
}

// Shared-world presence is stored in D1 so different Worker isolates see the
// same players. Coordinates are game tiles, never device/location information.
export const WORLD_MAP_BOUNDS = Object.freeze({"village":[44,30],"meadow":[44,30],"pollenwood":[44,30],"grotto":[44,30],"harbor":[44,30],"coast":[44,30],"glassreef":[44,30],"bellcavern":[44,30],"orchard":[44,30],"reedroad":[44,30],"forest":[44,30],"mistmarsh":[44,30],"moonvillage":[44,30],"runepass":[44,30],"ruins":[44,30],"deepwood":[44,30],"dunehamlet":[44,30],"desert":[44,30],"tower":[44,30],"silkgully":[44,30],"frosttown":[44,30],"glacier":[44,30],"mirrorlake":[44,30],"auroraisle":[44,30],"emberforge":[44,30],"ashgarden":[44,30],"volcano":[44,30],"basaltgate":[44,30],"observatory":[44,30],"astralpass":[44,30],"prismarchive":[44,30],"tidevault":[44,30],"astrumcity":[44,30],"windviaduct":[44,30],"cinderopera":[44,30],"raincistern":[44,30],"cloudstation":[44,30],"cirrusgarden":[44,30],"mossbasilica":[44,30],"thornlabyrinth":[44,30],"saltmarket":[44,30],"coralisle":[44,30],"dawnisle":[44,30],"glassisle":[44,30],"opalcity":[44,30],"tempestisle":[44,30],"orchidisle":[44,30],"obsidiancrypt":[44,30],"ferrumworks":[44,30],"cinderisle":[44,30],"sunforge":[44,30],"abysslift":[44,30],"saffronterrace":[44,30],"cedarcanopy":[44,30],"fernstation":[44,30],"vermilliongate":[44,30],"fulgurpass":[44,30],"zephyrcauseway":[44,30],"aurorafjord":[44,30],"pelagicspire":[44,30],"coralobservatory":[44,30],"shelltown":[44,30],"lunettecity":[44,30],"meridianleague":[44,30],"shinonomeport":[44,30],"dawnshoal":[44,30],"mistlighthouse":[44,30],"tidecaves":[44,30],"asanagicity":[44,30],"mirrorpaddy":[44,30],"whaleshrine":[44,30],"kelpdeep":[44,30],"wakamoevillage":[44,30],"sproutdowns":[44,30],"giantstump":[44,30],"rootmaze":[44,30],"shinkiroasis":[44,30],"dunesea":[44,30],"sunziggurat":[44,30],"sandtomb":[44,30],"hakuchucity":[44,30],"saltflats":[44,30],"prismgarden":[44,30],"geodecave":[44,30],"haehighland":[44,30],"windmillroad":[44,30],"kitecliff":[44,30],"galecanyon":[44,30],"shuutown":[44,30],"rainforestpath":[44,30],"thunderfalls":[44,30],"floodcistern":[44,30],"treetopvillage":[44,30],"mossroad":[44,30],"spiritcedar":[44,30],"jukaideep":[44,30],"akaneforge":[44,30],"mapleslope":[44,30],"lavaterrace":[44,30],"magmavault":[44,30],"haricity":[44,30],"glassdunes":[44,30],"mirrorhall":[44,30],"crystalmine":[44,30],"yuunagiport":[44,30],"sunsetcape":[44,30],"skybridge":[44,30],"windtunnel":[44,30],"tasogarevillage":[44,30],"goldfield":[44,30],"scarecrowhill":[44,30],"harvestvault":[44,30],"yoiharbor":[44,30],"fireflyriver":[44,30],"tidetemple":[44,30],"abyssreef":[44,30],"stardusttown":[44,30],"meteorfield":[44,30],"cometforge":[44,30],"craterdepths":[44,30],"geppakucity":[44,30],"moonsnow":[44,30],"auroragate":[44,30],"icepalace":[44,30],"zenithgate":[44,30],"starstair":[44,30],"twinmeridian":[44,30],"zenithcrossing":[44,30],"interior-village-1":[18,16],"interior-village-2":[18,16],"interior-village-3":[18,16],"interior-harbor-1":[18,16],"interior-harbor-2":[18,16],"interior-harbor-3":[18,16],"interior-orchard-1":[18,16],"interior-orchard-2":[18,16],"interior-orchard-3":[18,16],"interior-moonvillage-1":[18,16],"interior-moonvillage-2":[18,16],"interior-moonvillage-3":[18,16],"interior-dunehamlet-1":[18,16],"interior-dunehamlet-2":[18,16],"interior-dunehamlet-3":[18,16],"interior-frosttown-1":[18,16],"interior-frosttown-2":[18,16],"interior-frosttown-3":[18,16],"interior-emberforge-1":[18,16],"interior-emberforge-2":[18,16],"interior-emberforge-3":[18,16],"interior-observatory-1":[18,16],"interior-observatory-2":[18,16],"interior-observatory-3":[18,16],"interior-astrumcity-1":[18,16],"interior-astrumcity-2":[18,16],"interior-astrumcity-3":[18,16],"interior-cloudstation-1":[18,16],"interior-cloudstation-2":[18,16],"interior-cloudstation-3":[18,16],"interior-saltmarket-1":[18,16],"interior-saltmarket-2":[18,16],"interior-saltmarket-3":[18,16],"interior-opalcity-1":[18,16],"interior-opalcity-2":[18,16],"interior-opalcity-3":[18,16],"interior-ferrumworks-1":[18,16],"interior-ferrumworks-2":[18,16],"interior-ferrumworks-3":[18,16],"interior-saffronterrace-1":[18,16],"interior-saffronterrace-2":[18,16],"interior-saffronterrace-3":[18,16],"interior-fulgurpass-1":[18,16],"interior-fulgurpass-2":[18,16],"interior-fulgurpass-3":[18,16],"interior-coralobservatory-1":[18,16],"interior-coralobservatory-2":[18,16],"interior-coralobservatory-3":[18,16],"interior-shinonomeport-1":[18,16],"interior-shinonomeport-2":[18,16],"interior-shinonomeport-3":[18,16],"interior-asanagicity-1":[18,16],"interior-asanagicity-2":[18,16],"interior-asanagicity-3":[18,16],"interior-mirrorpaddy-1":[18,16],"interior-mirrorpaddy-2":[18,16],"interior-wakamoevillage-1":[18,16],"interior-wakamoevillage-2":[18,16],"interior-wakamoevillage-3":[18,16],"interior-shinkiroasis-1":[18,16],"interior-shinkiroasis-2":[18,16],"interior-shinkiroasis-3":[18,16],"interior-hakuchucity-1":[18,16],"interior-hakuchucity-2":[18,16],"interior-hakuchucity-3":[18,16],"interior-haehighland-1":[18,16],"interior-haehighland-2":[18,16],"interior-haehighland-3":[18,16],"interior-shuutown-1":[18,16],"interior-shuutown-2":[18,16],"interior-shuutown-3":[18,16],"interior-treetopvillage-1":[18,16],"interior-treetopvillage-2":[18,16],"interior-treetopvillage-3":[18,16],"interior-akaneforge-1":[18,16],"interior-akaneforge-2":[18,16],"interior-akaneforge-3":[18,16],"interior-lavaterrace-1":[18,16],"interior-lavaterrace-2":[18,16],"interior-haricity-1":[18,16],"interior-haricity-2":[18,16],"interior-haricity-3":[18,16],"interior-yuunagiport-1":[18,16],"interior-yuunagiport-2":[18,16],"interior-yuunagiport-3":[18,16],"interior-tasogarevillage-1":[18,16],"interior-tasogarevillage-2":[18,16],"interior-tasogarevillage-3":[18,16],"interior-yoiharbor-1":[18,16],"interior-yoiharbor-2":[18,16],"interior-yoiharbor-3":[18,16],"interior-stardusttown-1":[18,16],"interior-stardusttown-2":[18,16],"interior-stardusttown-3":[18,16],"interior-cometforge-1":[18,16],"interior-cometforge-2":[18,16],"interior-geppakucity-1":[18,16],"interior-geppakucity-2":[18,16],"interior-geppakucity-3":[18,16],"interior-zenithgate-1":[18,16],"interior-zenithgate-2":[18,16],"interior-zenithgate-3":[18,16],"interior-zenith-library":[18,16],"interior-glitch":[18,16]});
// Generated from actual #/B wall tiles and walkable approaches in the published solo maps.
// Each packed uint16 is (tileIndex << 4) | allowed facing bits (up/right/down/left).
const ROOM_WALL_GROUPS = Object.freeze(["C1ILqAvSDCgM8g1IDhIOaA6SDugPshAIENIRKBGoEnISyBOTE6ET6RQTFCEUaRUzFUEViSlYTmQ","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2BBiEJgTIhNYFeIWGBiiGNgbYhuYHiIeWCDiIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg24jcYOaI52DxiPJg_Ij9YQeJCGESiRNhHYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDdgQmBNYFeIWGBiiGNgbmB5YIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg3GDnYPJg_Ij9YQeJCGETYR5hKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQxBEEEUQRhBHEEgQSRBKEEsQTBBNEE4QTxBQEFEQUhBTEFQQVRBZgIIghYCuILGA2iDdgQYhCYEyITWBXiFhgYohjYG2IbmB4iHlgg4iEYI6Ij2CZiJpgpIiwYLqIu2DFiMZg0IjRYNuI3GDmiOdg8YjyYPyI_WEHiQhhEokTYR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1QLZAt0C4QLlAukC9QL5Av0DAQMFAwkDPQNBA0UDSQNNA1EDaIN2BBiEJgTIhNYFeIWGBiiGNgbYhuYHiIeWCDiIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg24jcYN1Y3ZDd8N5Y3pDmiOdg6Ejo4OlI8YjyYPNI8-D0SPyI_WD-SP7g_0kHiQhhEokTYR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","G2IbmB4iHlgg4iEYI6Ij2CZiJpgpIiwYLqIu2DFiMZg0IjRYNuI3GDmiPGJOFE4kTjRORE5UTmROdE6ETpROpA","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC0YLVAtkC3wL8gwYDDYMRAxcDHYMhAyUDKwMwgzoDZIN6A4CDjgOsg7YDvIPGA8yD2gPgg-oEFIQqBDCEPgRchGYEbMRwRHZEfMSARIREikSQhJoExITaBODE5EToRO5FDMUQRRZFQMVERUpFdIWKBiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHWgeEh5oHzIfWCACICgg0iEoIfIiwiLoI5Ij9CQEJBQkJCQ8JFYkZCR0JIQklCSkJPQlBCUcJTYlRCVUJWQldCW0JcQl1CXkJfwmFiYkJjQmRCaxJsEm0SbhJvknEychJzEnQSdRJ2EncSeBJ5EnoSexJ8En2SfzKAEoESghKDEoQShRKGEocSiBKJEooSi5KNMo4SjxKQEsNCxELFQsZCx8LJYspCy0LMQs1CzkLPQtBC0ULSQtNC1ELVwtdi2ELZQtpC20LcQt1C3kLfQuBC4ULiQuPC5WLmQudC6ELvEvAS8RLyEvOS9SL2EvcS-BL5EvoS_hL_EwATAZMDMwQTBRMGEwcTCxMMEw0TDhMPkxEzEhMTExQTGoMnIymDNCM2g0EjRoNTI1WDYCNig20jcoN_I4GDg2OEQ4WDh2OIQ4lDisOMI46DmSOeg6sjrYOvI7GDsyO2g7gjuoPFI8qD1zPYE9mT2yPdg98j4oPkM-UT5pPrY-xD7UPuQ-_D8SP2hAc0CBQJlAs0DBQNFA6UFyQbhB0kIoQvZDBEMcQ8ZD1EPsRHhEkkToRbJF2EaCRqhG80cBRxFHIUc5R1JHqEhySJhJQkloShJKdEqESpRKpEq0SsRK1ErkSvRLBEsUSyRLZEt0S4RLnEu2S8RL1EvkS_RMNExETFRMZEx0TIRMlEykTLRMxE5k","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1YLZAt0C4QLlAusC9YL5Av0DAQMFAwsDPYNBA0UDSQNNA1MDaIN2A4SDmgOkg7oD7IQCBBiEJgQ0hEoEVIRqBJyEsgTIhNYE5MToRPpFBMUIRRpFTMVQRWJFeIWGBiiGNgbYhuYHiIeWCDiIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg24jcYN1Y3ZDd8N5Y3rDmiOdg6Ejo4OlI6aDxiPJg80jz4PRI9KD8iP1g_kz-hP7k_0z_pQeJCGESiRNhHYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMRAyEDQQNRA2EDcQOBA5EDoQPBA9ED8QQBBCEEMQRRBGEEcQSBBJEEoQSxBNEE4QUBBREFMQVBBZgK4gsYDaIQYhCYEyITWBYYGKIY2BtiHiIeWCDiIRgj2CZiJpgpIiwYLqIu2DGYNCI0WDmiOdg8Yj8iP1hB4kIYRNhHYkeYSiJM4k00TURNZE10TYRNlE2kTbRNxE3kTfROFE4kTkROVE5kTnROhE6UTqROtE7ETtRO9E8ETyRPNE9UT2RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1YLZAt0C4QLlAusC9YL5Av0DAQMFAwsDPYNBA0UDSQNNA1MDaIN2A4SDmgOkg7oD7IQCBBiEJgQtxDFETURRRG1EcUR3RH3EgUSFRIlEjUSRRJVEmUS1RLlEvUTDRMiE1gTkxOhE-kUExQhFGkVMxVBFYkV4hYYGKIY2BtiG5geIh5YHncehR6VHqUevR7XHuUe9R8BHxUfJR89H1cfZR91H4UfnR-3H8Uf1R_lH_UgBSAVICUgNSBFIF0ghyCVIKUgtSDNIOIhGCOiI9gmYiaYKSIsGC6iLtgxYjGYNCI0WDbiNxg3NzdFN1Q3ZDd8N5Y3pDe1N8U31TflN_U4BTgVOCU4NThFOF04dziFOJU4pTi1OMU41TjlOPU5BTkVOS05RzlVOWU5dTmNOaI52DoSOjg6UjpoPGI8mDzSPPg9Ej0oPyI_WD-TP6E_uT_TP-lB4kIYRKJE2ET3RQVFFUUlRT1FV0VlRXVFhUWVRaVFtUXFRdVF5UX1RgVGHUY3RkVGVUZlRnVGhUaVRqVGtUbFRtVG7UcHRxVHJUc1R01HYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgI1wjkCPQJDAoWCiQKNApNCuILGAujC9wMxgz5DaIN2A5yDoEOkQ6tD3cPgQ-RD6gQYhCYEQcRFBEkETgRphG0EcQR3BH2EgQSHBJiEnQShBKdEyITWBPTFAwUYhSYFLIU2BUWFUkV4hYYFqMW3BciF1gXcheYF8YX-RiiGNgZchmBGZEZrRniGhgaMhpYGncagRqRGqgbYhuYHAccFBwkHDgcohzYHPIdGB1iHXQdhB2dHiIeWB7THwwfYx9xH4EfmR-zH8Ef2SAWIEkg4iEYIaMh3CLGIvkjoiPYJHIkgSSRJK0ldyWBJZElqCZiJpgnBycVJyUnOShjKHUohSidKSIsGCylLLQsxCzcLcYt1C3kLf0uoi7YL3IvgS-RL60wdzCBMJEwqDFiMZgyBzIUMiQyODNiM3QzhDOdNCI0WDTTNQw2FjZJNuI3GDejN9w4xjj5OaI52DpyOoE6kTqtO3c7gTuRO6g8YjyYPQc9FD0kPTg-Yj50PoQ-nT8iP1g_00AMQRZBSUHiQhhCo0LcQ8ZD-USiRNhFckWBRZFFrUZ3RoFGkUaoR2JHmEgHSBVIJUg5SWNJdUmFSZ1KIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE3ETdRN5E30TgROFE4kTjRORE5UTmROdE6ETpROpE60TsRO1E7kTvRPBE8UTyRPNE9ET1RPZE90T4RPlA","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBtEG4QbxBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC_IMGAzCDOgNkg3oDhYOLA6yDtgPBg8cD4IPqA_mD_wQUhCoENIQ6BFyEZgRwhHYEkISaBKiErgTEhNoE5ITqBQzFEEUWRSCFJgVAxURFSkVYhV4FdIWKBZTFmkXQxdZGCMYORiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHhIeaB8yH1ggAiAoINIhKCHyIsIi6COSI_QkBCQUJCQkPCRWJGQkdCSEJJQkpCT0JQQlHCU2JUQlVCVkJXQltCXEJdQl5CX8JhYmJCY0JkQmsSbBJtEm4Sb5JxMnIScxJ0EnUSdhJ3EngSeRJ6EnsSfBJ9kn8ygBKBEoISgxKEEoUShhKHEogSiRKKEouSjTKOEo8SkBLDQsRCxULGQsfCyWLKQstCzELNQs5Cz0LQQtFC0kLTQtRC1cLXYthC2ULaQttC3ELdQt5C30LgQuFC4kLjwuVi5kLnQuhC7xLwEvES8hLzkvUi9hL3EvgS-RL6Ev4S_xMAEwGTAzMEEwUTBhMHEwsTDBMNEw4TD5MRMxITExMUExqDJyMpgzQjNoNBI0aDUyNVg2AjYoNtI3KDdWN2w38jgYOEY4XDjCOOg5Jjk8OZI56DoSOig6sjrYOwI7GDuCO6g74jv4PFI8qDzSPOg9cz2BPZk9wj3YPkM-UT5pPqI-uD8SP2g_kz-pQINAmUFjQXhB0kIoQvZDBEMcQ8ZD1EPsRJJE6EWyRdhGgkaoR1JHqEhySJhJQkloShJKdEqESpRKpEq0SsRK1ErkSvRLBEsUSyRLZEt0S4RLnEu2S8RL1EvkS_RMNExETFRMZEx0TIRMlEykTLRMxE5k","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC_IMGAzCDOgNkg3oDrIO2A-CD6gQUhCoEXIRmBJCEmgTEhNoFDMUQRRZFQMVERUpFdIWKBiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHWgeEh5oHzIfWCACICgg0iEoIfIiwiLoI5Ij9CQEJBQkJCQ8JFYkZCR0JIQklCSkJPQlBCUcJTYlRCVUJWQldCW0JcQl1CXkJfwmFiYkJjQmRCaxJsEm0SbhJvknEychJzEnQSdRJ2EncSeBJ5EnoSexJ8En2SfzKAEoESghKDEoQShRKGEocSiBKJEooSi5KNMo4SjxKQEsNCxELFQsZCx8LJYspCy0LMQs1CzkLPQtBC0ULSQtNC1ELVwtdi2ELZQtpC20LcQt1C3kLfQuBC4ULiQuPC5WLmQudC6ELvEvAS8RLyEvOS9SL2EvcS-BL5EvoS_hL_EwATAZMDMwQTBRMGEwcTCxMMEw0TDhMPkxEzEhMTExQTGoMnIymDNCM2g0EjRoNTI1WDYCNig20jcoN_I4GDjCOOg5kjnoOrI62DuCO6g8UjyoPXM9gT2ZPkM-UT5pPxI_aEHSQihC9kMEQxxDxkPUQ-xEkkToRbJF2EaCRqhHUkeoSHJImElCSWhKEkp0SoRKlEqkSrRKxErUSuRK9EsESxRLJEtkS3RLhEucS7ZLxEvUS-RL9Ew0TERMVExkTHRMhEyUTKRMtEzETmQ","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1YLZAt0C4QLlAusC9YL5Av0DAQMFAwsDPYNBA0UDSQNNA1MDaIN2A4SDmgOkg7oD7IQCBBiEJgQ0hEoEVIRqBJyEsgTIhNYE5MToRPpFBMUaRUzFUEViRXiFhgYohjYG2IbmB4iHlgg4iEYI6Ij2CZiJpgpIiwYLqIu2DFiMZg0IjRYNuI3GDmiOdg8YjyYPyI_WEHiQhhEokTYR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2A3_DhcOJQ41Dk0O5w71DwUPHQ83D0UPVQ9tEAcQFRAlED0QYhCYERcRJRE1EU0RZxF1EYURnRI3EkUSVRJtEocSlRKlEr0TIhNYFeIWGBiiGNgbYhuYG78b1xvlG_UcDRynHLUcxRzdHPcdBR0VHS0dxx3VHeUd_R4iHlge1x7lHvUfDR8nHzUfRR9dH_cgBSAVIC0gRyBVIGUgfSDiIRgjoiPYJmImmCkiLBgslyylLLUszSznLPUtBS0dLbctxS3VLe0uBy4VLiUuPS6iLtgxYjGYNCI0WDbiNxg3PzdXN2U3dTeNOCc4NThFOF04dziFOJU4rTlHOVU5ZTl9OaI52DpXOmU6dTqNOqc6tTrFOt07dzuFO5U7rTvHO9U75Tv9PGI8mD8iP1hB4kIYRKJE2ET_RRdFJUU1RU1F50X1RgVGHUY3RkVGVUZtRwdHFUclRz1HYkeYSBdIJUg1SE1IZ0h1SIVInUk3SUVJVUltSYdJlUmlSb1KIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE3ETdRN5E30TgROFE4kTjRORE5UTmROdE6ETpROpE60TsRO1E7kTvRPBE8UTyRPNE9ET1RPZE90T4RPlA","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC4YLlQulC7ULxQvVC-UL9QwFDBUMJQw1DEUMXQx3DIUMlQylDLUMxQzVDOUM9Q0FDRUNJQ08DaIN2A5KD_oQYhCYEQoRNhFFEVURZRF1EYURlRGlEbURxRHdEfcSBRIVEiUSNRJFElUSZRJ1EowSuhMiE1gTyhP6FUoVehXiFhgWiha6FuYW9RcFFxUXJRc1F0UXXRd3F4UXlRelF7UXxRfcGAoYOhiiGNgZShl6GaoamhrKGvobYhuYHAocMhxqHJYcpRy1HMUc3Rz3HQUdFR0sHVodih26HiIeWB7KHvofKh9aH-ogGiBKIHog4iEYIYohuiHqIhoiqiLaIwojOiOiI9gkSiR6JKok2CVqJZolyiX6JmImmCcLJzsnayebKCsoWyiLKLspIiwYLI4svizuLR4tri3eLg4uPi6iLtgvSi96L6ov2jBqMJowyjD6MWIxmDICMjoyajKaMyozWjOKM7I0IjRYNMo0-jUqNVM1ZTV1NYU1nTW3NcU11TXpNho2SjZ6NuI3GDeKN7o36jjaOQo5OjmiOdg6Sjp6OqM6tTrFOtU65Tr1OwU7HTs3O0U7VTtlO3U7hTuZO8o7-jxiPJg9Cj06Poo-uj8iP1g_yj_zQAVAFUAlQDVARUBVQGVAdUCFQJ1At0DFQNVA5UD1QQVBFUElQTVBSUF6QeJCGEKKRDhEokTYRUNFVUVlRXVFhUWVRaVFtUXFRdVF5UX1RgVGHUY3RkVGVUZlRnVGhUaVRqVGtUbFRtVG4Ub5R2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQxBEEEUQRhBHEEgQSRBKEEsQTBBNEE4QTxBQEFEQUhBTEFQQVRBZgIIghYCPYJBQkVCS0J9woFChUKLAriCxgLhwuUC6QLuAziDPQNBA0dDaIN2A5TDowPlg_JEGIQmBEjEVwRphG0EcQR3BH2EgQSHBJGEnkTIhNYE_IUARQRFC0UYhSYFLIU2BT3FQEVERUoFeIWGBaHFpQWpBa4FyIXWBdyF5gX4hf0GAQYHRiiGNgZUxmMGeIaGBoyGlgalhrJG2IbmBwjHFwcohzYHPIdGB1GHXkeIh5YHvIfAR8RHy0fYx9xH4EfmR-zH8Ef2R_3IAEgESAoIOIhGCGHIZQhpCG4IuIi9CMEIx0joiPYJFMkjCWWJckmYiaYJyMnMSdBJ10oRyhRKGEoeSkiLBgshyyULKQsvC3mLfQuBC4dLqIu2C9SL4wwljDJMWIxmDIhMlwzRjN5NCI0WDTyNQE1ETUtNfc2ATYRNig24jcYN4c3lDekN7g44jj0OQQ5HTmiOdg6UzqMO5Y7yTxiPJg9Iz1cPkY-eT8iP1g_8kABQBFALUD3QQFBEUEoQeJCGEKHQpRCpEK4Q-JD9EQERB1EokTYRVNFjEaWRslHYkeYSCNIMUhBSF1JR0lRSWFJeUoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgIhgiUCKQItAjECNQI5Aj1CQUJFAkkCTQJRAlUCWQJdQmFCZ0JtwnFCdUJ5Qn1CgUKFQolCjQKRApUCmQKdAqECpUKpQq8CuILGAtCC6gL0gwoDPINSA16DaIN2A4CDmgOkg7oD7IQCBA6EGIQmBDCESgRUhGoEnISyBL6EyITWBOCE5EToRPpFBMUIRRpFTMVQRWJFboV4hYYFkoYehiiGNgZChs6G2IbmBvKHfoeIh5YHooguiDiIRghSiN6I6Ij2CQKJjomYiaYJsso-ykiLBgsTi5-LqIu2C8KMToxYjGYMcoz-jQiNFg0ija6NuI3GDdKOXo5ojnYOgo8OjxiPJg8yj76PyI_WD-KQbpB4kIYQkpEekSiRNhFCkc6R2JHmEfDR9VH5Uf1SAVIFUglSDVIRUhVSGVIdUiFSJVIpUi1SMVI3Uj3SQVJFUklSTVJRUlVSWVJdUmFSZVJpUm1ScVJ1UnlSflKIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE3ETdRN5E30TgROFE4kTjRORE5UTmROdE6ETpROpE60TsRO1E7kTvRPBE8UTyRPNE9ET1RPZE90T4RPlA","AuEC8QMBAxEDIQMxA0EDUQNhA3EEwQTRBOEE8QUBBREFIQUxBUEFUQWYCCIIWAriCxgNog3YEGIQmBMiE1gV4hYYGKIY2BtiG5geIh5YIOIhGCOiI9gmYiaYKSIsGC6iLtgxYjGYNCI0WDbiNxg5ojnYPGI8mD8iP1hB4kIYRKJE2EdiR5hKIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE5kTwRPFE8kTzRPRE9UT2RPdE-ET5Q","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC0YLVAtkC3wL8gwYDDYMRAxcDHYMhAyUDKwMwgzoDZIN6A4CDjgOsg7YDvIPGA8yD2gPgg-oEFIQqBDCEPgRchGYEbMRwRHZEfMSARIREikSQhJoExITaBODE5EToRO5FDMUQRRZFQMVERUpFdIWKBiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHWgeEh5oHzIfWCACICgg0iEoIfIiwiLoI5Ij9CQEJBQkJCQ8JFYkZCR0JIQklCSkJPQlBCUcJTYlRCVUJWQldCW0JcQl1CXkJfwmFiYkJjQmRCaxJsEm0SbhJvknEychJzEnQSdRJ2EncSeBJ5EnoSexJ8En2SfzKAEoESghKDEoQShRKGEocSiBKJEooSi5KNMo4SjxKQEsNCxELFQsZCx8LJYspCy0LMQs1CzkLPQtBC0ULSQtNC1ELVwtdi2ELZQtpC20LcQt1C3kLfQuBC4ULiQuPC5WLmQudC6ELvEvAS8RLyEvOS9SL2EvcS-BL5EvoS_hL_EwATAZMDMwQTBRMGEwcTCxMMEw0TDhMPkxEzEhMTExQTGoMnIymDNCM2g0EjRoNTI1WDYCNtI3KDfyOBg4NjhEOFw4djiEOJQ4rDjCOOg5kjnoOrI62DryOxg7MjtoO4I7qDxSPKg9cz2BPZk9sj3YPfI-KD5DPlE-aT62PsQ-1D7kPvw_Ej9oQHNAgUCZQLNAwUDRQOlBckG4QdJCKEL2QwRDHEPGQ9RD7ER4RJJE6EWyRdhGgkaoRvNHAUcRRyFHOUdSR6hIckiYSUJJaEoSSnRKhEqUSqRKtErEStRK5Er0SwRLFEskS2RLdEuES5xLtkvES9RL5Ev0TDRMRExUTGRMdEyETJRMpEy0TMROZA","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC0YLVAtkC3QLhAuUC6QLtAvEC9QL5Av0DAQMFAwsDNYM5Az0DQQNFA0kDTQNRA1UDWwNog3YDgIO6A-SECgQYhCYEMIRqBJSEugTIhNYE4IUIRRpFRIVqBXiFhgWQhZ4FpIW2BfSGBgYMhhoGKIY2BkCGTgZUhmYGpIa2BryGygbYhuYG8Mb0RvhG_kcExwhHDEcWR1THWEdcR2BHZkdsx3BHdEd6R4iHlgg4iEYI6Ij2CZiJpgpIiwYLqIu2DFiMZg0IjRYNuI3GDdWN2Q3fDeWN6w5ojnYOhI6ODpSOmg8YjyYPNI8-D0SPSg_Ij9YP5M_oT-5P9M_6UHiQhhEokTYR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2BBiEJgRxhHcEg4TIhNYFEYUVBRkFHUUgRSZFLcUwRTVFOQU9BUNFeIWGBb2FwEXERcpF6MXuRfeGKIY2BmmGbkakhqkGrwbYhuYHFYcaR1hHY0eIh5YHwYfGSA7IOIhGCG2IcgjBiMcI6Ij2CRyJIglwiXYJmImmCcnJzEnSSiDKJEorSkiLBgspyy0LM0uBi4dLqIu2C97MMsxYjGYMk4znjQiNFg09zUcNkY2WTbiNxg3wzfsOPY5CTmiOdg6kzqpO6c7uTxiPJg9dz2EPZQ9rD4mPj0-Xz8iP1hAQ0BRQGFAfUCeQLZAxEDVQOlBD0HiQhhDR0NZQ3NDiUSiRNhHYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQxBEEEUQRhBHEEgQSRBKEEsQTBBNEE4QTxBQEFEQUhBTEFQQVRBZgIIghYCPYJBQkVCS0J9woFChUKLAriCxgLhwuUC6QLuAziDPQNBA0dDaIN2A5TDowPlg_JEGIQmBEjEVwRphG0EcQR3BH2EgQSHBJGEnkTIhNYE_IUARQRFC0UYhSYFLIU2BT3FQEVERUoFeIWGBaHFpQWpBa4FyIXWBdyF5gX4hf0GAQYHRiiGNgZUxmMGeIaGBoyGlgalhrJG2IbmBwjHFwcohzYHPIdGB1GHXkeIh5YHvIfAR8RHy0fYx9xH4EfmR-zH8Ef2R_3IAEgESAoIOIhGCGHIZQhpCG4IuIi9CMEIx0joiPYJFMkjCWWJckmYiaYJyMnMSdBJ10oRyhRKGEoeSkiLBgshyyULKQsvC3mLfQuBC4dLqIu2C9SL4wwljDJMWIxmDIhMlwzRjN5NCI0WDTyNRE1LTX3NgE2ETYoNuI3GDeHN5Q3pDjiOPQ5BDkdOaI52DpTOog7ljvJPGI8mD0jPVw-Rj55PyI_WD_yQAFAEUAtQPdBAUERQShB4kIYQodClEKkQrhD4kP0RAREHUSiRNhFU0WMRpZGyUdiR5hII0gxSEFIXUlHSVFJYUl5SiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1YLZAt0C4QLlAusC9YL5Av0DAQMFAwsDPYNBA0UDSQNNA1MDaIN2A4SDmgOkg7oD7IQCBBiEJgQ0hEoEVIRqBJyEsgTIhNYE5MToRPpFBMUIRRpFTMVQRWJFeIWGBiiGNgbYhuYHiIeWCDiIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg24jcYOaI52DxiPJg_Ij9YQeJCGESiRNhHYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBtEG4QbxBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC_IMGAzCDOgNkg3oDhYOLA6yDtgPBg8cD4IPqA_mD_wQUhCoENIQ6BFyEZgRwhHYEkISaBKiErgTEhNoE5ITqBQzFEEUWRSCFJgVAxURFSkVYhV4FdIWKBZTFmkXQxdZGCMYORiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHWgeEh5oHzIfWCACICgg0iEoIfIiwiLoI5Ij9CQEJBQkJCQ8JFYkZCR0JIQklCSkJPQlBCUcJTYlRCVUJWQldCW0JcQl1CXkJfwmFiYkJjQmRCaxJsEm0SbhJvknEychJzEnQSdRJ2EncSeBJ5EnoSexJ8En2SfzKAEoESghKDEoQShRKGEocSiBKJEooSi5KNMo4SjxKQEsNCxELFQsZCx8LJYspCy0LMQs1CzkLPQtBC0ULSQtNC1ELVwtdi2ELZQtpC20LcQt1C3kLfQuBC4ULiQuPC5WLmQudC6ELvEvAS8RLyEvOS9SL2EvcS-BL5EvoS_hL_EwATAZMDMwQTBRMGEwcTCxMMEw0TDhMPkxEzEhMTExQTGoMnIymDNCM2g0EjRoNTI1WDYCNig20jcoN1Y3bDfyOBg4RjhcOMI46DkmOTw5kjnoOhI6KDqyOtg7AjsYO4I7qDviO_g8UjyoPNI86D1zPYE9mT3CPdg-Qz5RPmk-oj64PxI_aD-TP6lAg0CZQWNBeEHSQihC9kMEQxxDxkPUQ-xEkkToRbJF2EaCRqhHUkeoSHJImElCSWhKEkp0SoRKlEqkSrRKxErUSuRK9EsESxRLJEtkS3RLhEucS7ZLxEvUS-RL9Ew0TERMVExkTHRMhEyUTKRMtEzETmQ","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgItgjNCUYJVQllCXUJhQmdCbcJxQnVCeUJ9QoMCocKnAriCxgLZgt5C-cL9QwJDMMM1QztDVMNbA2iDdgOFg4pDoYOnQ-3D8wQIxA8EGIQmBDGENkRNxFJEoMSnRLzEwwTIhNYE4oT7xRWFGUUdRSFFJ0UtxTFFNUU5RT8FW8VyhXiFhgWNhZJFp4W9hcFFxkXsxfFF9wYPhiLGKIY2Bj6GUYZWRmmGbkakxqsGvMbDBtiG5gbuxwLHFYcaR1jHXwdyx4iHlgevh8GHxkgMyBMIJ4g4iEYIXohyiMKI1ojoiPYJCYkOCSKJNolfiXKJhImLCZiJpgm4yb5JzcnSSeHJ5koMyhNKIMonSjTKOkpIiwYLGYsfCy3LMwtBy0cLbYtzS4GLh0uVi5sLqIu2C8jLzgvii_bMHswyjESMSkxYjGYMfoySjOKM9o0IjRYNLs1AzUcNjY2STabNuI3GDc-N4430zfsOOY4-TlOOaI52Dn6OkM6XDqjOrw7ljupO_Y8CTxiPJg8szzMPRs9cz2FPZw-Nj5FPlk-uz8OPyI_WD-KP-9AU0BlQHVAhUCdQLdAxUDVQOVA-UFvQcpB4kIYQkNCXEK3QsxEBkQdRHZEiUSiRNhFE0UsRYNFnUa3RslHJkc5R2JHmEfjR_1IZ0h1SI1JR0lVSW1J10npSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQxBEEEUQRhBHEEgQSRBKEEsQTBBNEE4QTxBQEFEQUhBTEFQQVRBZgIIghYCPYJBQkVCS0J9woFChUKLAriCxgLhwuUC6QLuAziDPQNBA0dDaIN2A5TDowPlg_JEGIQmBEjEVwRphG0EcQR3BH2EgQSHBJGEnkTIhNYE_IUARQRFC0UYhSYFLIU2BT3FQEVERUoFeIWGBaHFpQWpBa4FyIXWBdyF5gX4hf0GAQYHRiiGNgZUxmMGeIaGBoyGlgalhrJG2IbmBwjHFwcohzYHPIdGB1GHXkeIh5YHvIfAR8RHy0fYx9xH4EfmR-zH8Ef2R_3IAEgESAoIOIhGCGHIZQhpCG4IuIi9CMEIx0joiPYJFMkjCWWJckmYiaYJyMnMSdBJ10oRyhRKGEoeSkiLBgshyyULKQsvC3mLfQuBC4dLqIu2C9SL4wwljDJMWIxmDIhMlwzRjN4NCI0WDTyNQE1ETUtNfc2ATYRNuI3GDeHN5Q3pDe4OOI5BDkdOaI52DpTOow7ljvJPGI8mD0jPVw-Rj55PyI_WD_yQAFAEUAtQPdBAUERQShB4kIYQodClEKkQrhD4kP0RAREHUSiRNhFU0WMRpZGyUdiR5hII0gxSEFIXUlHSVFJYUl5SiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEDAQMRAzEDQQNRA2EDcQOBA5EDsQPBA-ED8QQRBCEEQQRRBGEEcQSBBJEEoQTBBNEE8QUBBSEFMQVBBVEFmAgiCFgLGA2iDdgQYhMiE1gV4hYYGNgbYhuYHiIg4iEYI6Ij2CaYKSIuoi7YMWI0IjRYNuI3GDnYPGI8mD8iQeJCGESiRNhHmEoiSlhM4k0kTTRNVE1kTXRNhE2UTaRNtE3UTeROBE4UTjRORE5kTnROhE6UTqROtE7ETuRO9E8UTyRPRE9UT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2A5HDlUOZQ51Do0Opw61Ds0PZw91D4UPlQ-tD8cP1Q_tEGIQmBC_ENcQ5RD9EZcRpRG1EcUR3RH3EgUSHRK3EsUS1RLlEv0TIhNYFeIWGBiiGNgbYhuYHAccFRwlHDUcTRxnHHUcjR0nHTUdRR1VHW0dhx2VHa0eIh5YHn8elx6lHr0fVx9lH3UfhR-dH7cfxR_dIHcghSCVIKUgvSDiIRgjoiPYJmImmCkiLBgsPyxXLGUsfS0XLSUtNS1FLV0tdy2FLZ0uNy5FLlUuZS59LqIu2DFiMZg0IjRYNuI3GDeHN5U3pTe1N8k35zf1OA04pzi1OMU41TjtOQc5FTktOaI52Dn_Ohc6JTo9Otc65Tr1OwU7HTs3O0U7XTv3PAU8FTwlPD08YjyYPyI_WEHiQhhEokTYRUdFVUVlRXVFjUWnRbVFzUZnRnVGhUaVRq1Gx0bVRu1HYkeYR79H10flR_1Il0ilSLVIxUjdSPdJBUkdSbdJxUnVSeVJ_UoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2BBiEJgRzxH2EgwTIhNYFEYUVBRkFH0UnxSzFMEU1RTtFQ4V4hYYFvYXARcRFykXtxfBF9wYohjYGZYZpBm5GpMapBq9G2IbmBxGHGkdax4iHlge9h8ZIDcgRCBcIOIhGCGyIcgjAiMYI6Ij2CRyJIglwiXYJmImmCcnJzEnSSiDKJkpIiwYLK8szi4WLi0uoi7YL3YviDDGMNgxYjGYMjIySDOCM5g0IjRYNPM1HDY2Nlk24jcYN8M32TjmOQk5ojnYOqc6vDuWO6E7uTxiPJg9cz2EPZQ9rT42PkQ-WT8iP1hAQ0BZQHdAhECcQLZAzUDnQPFBCUHiQhhDQ0NZQ3tEokTYR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC4YLlQulC7ULxQvVC-UL9QwFDBUMJQw1DEUMXQx3DIUMlQylDLUMxQzVDOUM9Q0FDRUNJQ08DaIN2A5KD_oQYhCYEQoRNhFFEVURZRF1EYURlRGlEbURxRHdEfcSBRIVEiUSNRJFElUSZRJ1EowSuhMiE1gTyhP6FUoVehXiFhgWiha6FuYW9RcFFxUXJRc1F0UXXRd3F4UXlRelF7UXxRfcGAoYOhiiGNgZShl6GaoamhrKGvobYhuYHAocOhxqHJYcpRy1HMUc3Rz3HQUdFR0sHVIdih26HiIeWB7KHvofKh9aH-ogGiBKIHog4iEYIYohuiHqIhoiqiLaIwojOiOiI9gkSiR6JKok2CVqJZolyiX6JmImmCcLJzsnayebKCsoWyiLKLspIiwYLI4svizuLR4tri3eLg4uPi6iLtgvSi96L6ov2jBqMJowyjD6MWIxmDICMjoyajKaMyozWjOKM7o0IjRYNMo0-jUqNVM1ZTV1NYU1nTW3NcU11TXpNho2SjZ6NuI3GDeKN7o36jjaOQo5OjmiOdg6Sjp6OqM6tTrFOtU65Tr1OwU7HTs3O0U7VTtlO3U7hTuZO8o7-jxiPJg9Cj06Poo-uj8iP1g_yj_zQAVAFUAlQDVARUBVQGVAdUCFQJ1At0DFQNVA5UD1QQVBFUElQTVBSUF6QeJCGEKKRDhEokTYRUNFVUVlRXVFhUWVRaVFtUXFRdVF5UX1RgVGHUY3RkVGVUZlRnVGhUaVRqVGtUbFRtVG4Ub5R2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1YLZAt0C4QLlAusC9YL5Av0DAQMFAwsDPYNBA0UDSQNNA1MDaIN2A4SDmgOkg7oD7IQCBBiEJgQtxDFETURRRG1EcUR3RH3EgUSFRIlEjUSRRJVEmUS1RLlEvUTDRMiE1gTkxOhE-kUExQhFGkVMxVBFYkV4hYYGKIY2BtiG5geIh5YHncehR6VHqUevR7XHuUe9R8FHxUfJR89H1cfZR91H4UfmR-3H8Uf1R_lH_UgBSAVICUgNSBFIF0ghyCVIKUgtSDNIOIhGCOiI9gmYiaYKSIsGC6iLtgxYjGYNCI0WDbiNxg3NzdFN1Q3ZDd8N5Y3pDe1N8U31TflN_U4BTgVOCU4NThFOF04dziFOJU4pTi1OMU41TjlOPU5BTkVOS05RzlVOWU5dTmNOaI52DoSOjg6UjpoPGI8mDzSPPg9Ej0oPyI_WD-TP6E_uT_TP-lB4kIYRKJE2ET3RQVFFUUlRT1FV0VlRXVFhUWVRaVFtUXFRdVF5UX1RgVGHUY3RkVGVUZlRnVGhUaVRqVGtUbFRtVG7UcHRxVHJUc1R01HYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEDAQMRAyEDMQNBA1EDYQOBA5EDsQPBA-ED8QQRBCEEMQRBBFEEYQRxBJEEoQTBBNEE8QUBBSEFMQVBBVEFmAgiCFgNog3YEGITIhNYFeIWGBjYG2IbmB4iIOIhGCOiI9gmmCkiLqIu2DFiMZg0WDbiNxg8YjyYPyJB4kIYRKJE2EeYSiJKWEziTSRNNE1ETVRNZE10TYRNpE20TdRN5E4EThRONE5ETlROZE50ToROlE60TsRO5E70TxRPJE9ET1RPZE90T4RPlA","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgIxgjUCOQI_AomCjQKRApcCuILGAtWC2QLdAvEC9QL5Av0DAQMFAwsDNYNJA00DUwNog3YDhIO6A-GEAgQYhCYENIRQRG0EcQR3BH2EgQSHBI3EkESURLIEyITWBOTE6ET-BQTFCEUmBSyFNgVIhWJFeIWGBaTFrgXIhdYF3IXmBfWGAkYohjYGWMZhBmcGeIaGBoyGlgahhq4G2IbmBwyHEEcURxtHKIc2BzyHRgdNx1BHVEeIh5YHtYe5B74H2MfcR-BH5kfsx_BH9kgIiBEIF0g4iEYIZMhzCLWIwkjoiPYJGMknCWGJbkmYiaYJzMnQSdRJ20oNyhBKFEoaSkiLBgslyykLLQszC3WLeQt9C4NLqIu2C9jL5wwhjC5MWIxmDIyMkEyUTJtMzczQTNRM2g0IjRYNNY05DT4NiI2NDZENl024jcYN1Y3ZDd8N5I3zDjWOQk5ojnYOhI6ODpSOpw7hju5PGI8mDzSPPg9Ej1BPVE9bT43PkE-UT5oPyI_WD-TP6E_uT_SP_hBIkE0QURBXUHiQhhCk0LMQ9ZECUSiRNhFY0WcRoZGuUdiR5hIM0hBSFFIbUk3SUFJUUlpSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC4YLnAwGDBwMxgzcDUYNXA2iDdgOQg5YDsIO2A-CD5gQAhAYEGIQmBECERgRghGYEkISWBLCEtgTIhNYE8MT2RRDFFkVAxUZFYMVmRXiFhgYohjYG2IbmB4iHlgg4iEYI6Ij2CZiJpgpIiwYLqIu2DFiMZg0IjRYNuI3GDmiOdg6RjpcOsY63DuGO5w8BjwcPGI8mD0CPRg9gj2YPkI-WD7CPtg_Ij9YP8I_2EBCQFhBAkEYQYJBmEHiQhhCgkKYQwJDGEPCQ9hEQkRYRKJE2EVDRVlFw0XZRoNGmUcDRxlHYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1QLZAt0C4QLlAukC9QL5Av0DAQMFAz0DQQNFA0kDTQNRA2iDdgQYhCYEyITWBXiFhgYohjYG2IbmB4iHlgg4iEYI6Ij2CZiJpgpIiwYLqIu2DFiMZg0IjRYNuI3GDmiOdg8YjyYPyI_WEHiQhhEokTYR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1YLZAt0C4QLlAusDPYNBA0UDSQNNA1MDaIN2A4SDmgPshAIEGIQmBC3EMURNRFFEVURZRF1EYURlRGlEbURxRHdEfcSBRIVEiUSNRJFElUSZRLVEuUS9RMNEyITWBOTE6ET6RUzFUEViRXiFhgYohjYG2IbmB4iHlgedx6FHpUepR69Htce5R71HwUfFR8lHzUfRR9VH2UfdR-FH50ftx_FH9Uf5R_1IAUgFSAlIDUgRSBdIIcglSClILUgzSDiIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg24jcYNzc3RTdUN2Q3fDeWN6Q3tTfBN9U35Tf1OAU4FTglODU4RThdOHc4hTiVOKU4tTjFONU45Tj1OQU5FTktOUc5VTllOXU5jTmiOdg6Ejo4OlI6aDxiPJg80jz4PRI9KD8iP1g_kz-hP7k_0z_pQeJCGESiRNhE90UFRRVFJUU9RVdFZUV1RYVFlUWlRbVFxUXVReVF9UYFRh1GN0ZFRlVGZUZ1RoVGlUalRrVGxUbVRu1HB0cVRyVHNUdNR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgI1wjkCPQJDAoWCiQKNApNCuILGAujC9wMxgz5DaIN2A5yDoEOkQ6tD3cPgQ-RD6gQYhCYEQcRFBEkETgRphG0EcQR3BH2EgQSHBJiEnQShBKdEyITWBPTFAwUYhSYFLIU2BUWFUkV4hYYFqMW3BciF1gXcheYF8YX-RiiGNgZchmBGZEZrRniGhgaMhpYGncagRqRGqgbYhuYHAccFBwkHDgcohzYHPIdGB1iHXQdhB2dHiIeWB7THwwfYx9xH4EfmR-zH8Ef2SAWIEkg4iEYIaMh3CLGIvkjoiPYJHIkgSSRJK0ldyWBJZElqCZiJpgnBycVJyUnOShjKHUohSidKSIsGCylLLQsxCzcLcYt1C3kLf0uoi7YL3IvgS-RL60wdzCBMKgxYjGYMgcyFDIkMjgzdDOEM500IjRYNNM1DDYSNkk24jcYN6M33DjGOPk5ojnYOnI6gTqROq07dzuBO5E7qDxiPJg9Bz0UPSQ9OD5iPnQ-hD6dPyI_WD_TQAxBFkFJQeJCGEKjQtxDxkP5RKJE2EVyRYFFkUWtRndGgUaRRqhHYkeYSAdIFUglSDlJY0l1SYVJnUoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC4YLlQulC7ULxQvVC-UL9QwFDBUMJQw1DEUMXQx3DIUMlQylDLUMxQzVDOUM9Q0FDRUNJQ08DaIN2A5KD_oQYhCYEQoRNhFFEVURZRF1EYURlRGlEbURxRHdEfcSBRIVEiUSNRJFElUSZRJ1EowSuhMiE1gTyhP6FUoVehXiFhgWiha6FuYW9RcFFxUXJRc1F0UXXRd3F4UXlRelF7UXxRfcGAoYOhiiGNgZShl6GaoamhrKGvobYhuYHAocMhxqHJYcpRy1HMUc3Rz3HQUdFR0sHVodih26HiIeWB7KHvofKh9aH-ogGiBKIHog4iEYIYohuiHqIhoiqiLaIwojOiOiI9gkSiR6JKok2CVqJZolyiX6JmImmCcLJzsnayebKCsoWyiLKLspIiwYLI4svizuLR4tri3eLg4uPi6iLtgvSi96L6ov2jBqMJowyjD6MWIxmDICMjoyajKaMyozWjOKM7o0IjRYNMo0-jUqNVM1ZTV1NYU1nTW3NcU11TXpNho2SjZ6NuI3GDeKN7o36jjaOQo5OjmiOdg6Sjp6OqM6tTrFOtU65Tr1OwU7HTs3O0U7VTtlO3U7hTuZO8o7-jxiPJg9Cj06Poo-uj8iP1g_yj_zQAVAFUAlQDVARUBVQGVAdUCFQJ1At0DFQNVA5UD1QQVBFUElQTVBSUF6QeJCGEKKRDhEokTYRUNFVUVlRXVFhUWVRaVFtUXFRdVF5UX1RgVGHUY3RkVGVUZlRnVGhUaVRqVGtUbFRtVG4Ub5R2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2A3_DhcOJQ41DkUOVQ5lDn0PHw83D0UPVQ9lD3UPhQ-dED8QYhCYEU8RZxF1EYURlRGlEbURzRJvEocSlRKlErUSxRLVEu0TIhNYFeIWGBiiGNgbYhuYG78b1xvlG_UcBRwVHCUcPRzfHPcdBR0VHSUdNR1FHVUd_x4iHlgfDx8nHzUfRR9VH2UfdR-NICsgRyBVIGUgdSCFIJUgrSDiIRgjoiPYJmImmCkiLBgszyznLPUtBS0VLSUtNS1NLe8uBy4VLiUuNS5FLlUubS6iLtgxYjGYNCI0WDbiNxg3PzdXN2U3dTeFN5U3pTe9OF84dziFOJU4pTi1OMU43Tl_OaI52DqPOqc6tTrFOtU65Tr1Ow07rzvHO9U75Tv1PAU8FTwtPGI8mD8iP1hB4kIYRKJE2ET_RRdFJUU1RUVFVUVlRX1GH0Y3RkVGVUZlRnVGhUadRz9HYkeYSE9IZ0h1SIVIlUilSLVIzUlvSYdJlUmlSbVJxUnVSe1KIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE3ETdRN5E30TgROFE4kTjRORE5UTmROdE6ETpROpE60TsRO1E7kTvRPBE8UTyRPNE9ET1RPZE90T4RPlA","DCgO6BGoFCEUaRtiG5geIh5YIOIhGCOiI9gmYiaYKSIsGC6iLtgxYjGYNCI0WDbiNxg5ojxiThROJE40TkROVE5kTnROhE6UTqQ","AuEC8QMBAxEDIQMxA0EDYQNxA5EDoQPBA9ED8QQBBBEEIQQxBEEEUQRxBIEEoQSxBNEE4QUBBREFIQUxBUEFUQWYCCIK4gsYDaIN2BCYEyITWBXiGKIY2BtiG5geWCDiIRgmYiaYKSIsGC6iLtgxmDQiNFg24jmiOdg8YjyYP1hB4kIYRKJHYkeYSiJKWE0kTTRNRE1UTWRNhE2UTbRNxE3kTfROFE4kTjRORE5UTmROdE6UTqROxE7UTvRPBE8kTzRPRE9UT2RPdE-E","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC_IMGAzCDOgNkg3oDrIO2A-CD6gQUhCoEXIRmBJCEmgTEhNoFDMUQRRZFQMVERUpFdIWKBiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHWgeEh5oHzIfWCACICgg0iEoIfIiwiLoI5Ij9CQEJBQkJCQ8JFYkZCR0JIQklCSkJPQlBCUcJTYlRCVUJWQldCW0JcQl1CXkJfwmFiYkJjQmRCaxJsEm0SbhJvknEychJzEnQSdRJ2EncSeBJ5EnoSexJ8En2SfzKAEoESghKDEoQShRKGEocSiBKJEooSi5KNMo4SjxKQEsNCxELFQsZCx8LJYspCy0LMQs1CzkLPQtBC0ULSQtNC1ELVwtdi2ELZQtpC20LcQt1C3kLfQuBC4ULiQuPC5WLmQudC6ELvEvAS8RLyEvOS9SL2EvcS-BL5EvoS_hL_EwATAZMDMwQTBRMGEwcTCxMMEw0TDhMPkxEzEhMTExQTGoMnIymDNCM2g0EjRoNTI1WDYCNtI3KDfyOBg4wjjoOZI56DqyOtg7gjuoPFI8qD1zPYE9mT5DPlE-aT8SP2hB0kIoQvZDBEMcQ8ZD1EPsRJJE6EWyRdhGgkaoR1JHqEhySJhJQkloShJKdEqESpRKpEq0SsRK1ErkSvRLBEsUSyRLZEt0S4RLnEu2S8RL1EvkS_RMNExETFRMZEx0TIRMlEykTLRMxE5k","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2A5nDnUOjQ6nDrUOxQ7VDu0Phw-VD60Pxw_VD-UP9RANEGIQmBC_ENcQ5RD1EQURHRG3EcUR3RH3EgUSFRIlEj0S1xLlEv0TIhNYFeIWGBiiGNgbYhuYHCccNRxNHGccdRyFHJUcrR1HHVUdbR2HHZUdpR21Hc0eIh5YHn8elx6lHrUexR7dH3cfhR-dH7cfxR_VH-Uf_SCXIKUgvSDiIRgjoiPYJmImmCkiLBgsPyxXLGUsdSyFLJ0tNy1FLV0tdy2FLZUtpS29LlcuZS59LqIu2DFiMZg0IjRYNuI3GDenN7U3zTfnN_U4BTgVOC04xzjVOO05BzkVOSU5NTlNOaI52Dn_Ohc6JTo1OkU6XTr3OwU7HTs3O0U7VTtlO308FzwlPD08YjyYPyI_WEHiQhhEokTYRWdFdUWNRadFtUXFRdVF7UaHRpVGrUbHRtVG5UbxRw1HYkeYR79H10flR_VIBUgdSLdIxUjdSPdJBUkVSSVJPUnXSeVJ_UoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC1YLZAt0C4QLlAusDPYNBA0UDSQNNA1MDaIN2A4SDmgPshAIEGIQmBC3EMURNRFFEVURZRF1EYURlRGlEbURxRHdEfcSBRIVEiUSNRJFElUSZRLVEuUS9RMNEyITWBOTE6ET6RUzFUEViRXiFhgYohjYG2IbmB4iHlgedx6FHpUepR69Htce5R71HwUfFR8lHzUfRR9VH2UfdR-FH50ftx_FH9Uf5R_1IAUgFSAhIDUgRSBdIIcglSClILUgzSDiIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg24jcYNzc3RTdUN2Q3fDeWN6Q3tTfFN9U35Tf1OAU4FTglODU4RThdOHc4hTiVOKU4tTjFONU45Tj1OQU5FTktOUc5VTllOXU5jTmiOdg6Ejo4OlI6aDxiPJg80jz4PRI9KD8iP1g_kz-hP7k_0z_pQeJCGESiRNhE90UFRRVFJUU9RVdFZUV1RYVFlUWlRbVFxUXVReVF9UYFRh1GN0ZFRlVGZUZ1RoVGlUalRrVGxUbVRu1HB0cVRyVHNUdNR2JHmEoiSlhM4k0kTTRNRE1UTWRNdE2ETZRNpE20TcRN1E3kTfROBE4UTiRONE5ETlROZE50ToROlE6kTrROxE7UTuRO9E8ETxRPJE80T0RPVE9kT3RPhE-U","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2A3_DhcOJQ41DkUOVQ5tDwcPHQ83D0UPVQ9lD3UPjRAnED0QYhCYETcRTRFnEXURhRGVEaURvRJXEm0ShxKVEqUStRLFEt0TIhNYFeIWGBiiGNgbYhuYG78b1xvlG_UcBRwVHC0cxxzdHPcdBR0VHSUdNR1NHecd_R4iHlge9x8NHycfNR9FH1UfZR99IBcgLSBHIFUgZSB1IIUgnSDiIRgjoiPYJmImmCkiLBgstyzNLOcs9S0FLRUtJS09Ldct7S4HLhUuJS41LkUuXS6iLtgxYjGYNCI0WDbiNxg3PzdXN2U3dTeFN5U3rThHOF04dziFOJU4pTi1OM05Zzl9OaI52Dp3Oo06pzq1OsU61TrlOv07lzutO8c71TvlO_U8BTwdPGI8mD8iP1hB4kIYRKJE2ET_RRdFJUU1RUVFVUVtRgdGHUY3RkVGVUZlRnVGjUcnRz1HYkeYSDdITUhnSHVIhUiVSKVIvUlXSW1Jh0mVSaVJtUnFSd1KIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE3ETdRN5E30TgROFE4kTjRORE5UTmROdE6ETpROpE60TsRO1E7kTvRPBE8UTyRPNE9ET1RPZE90T4RPlA","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC0YLVAtkC3wL8gwYDDYMRAxcDHYMhAyUDKwMwgzoDZIN6A4CDjgOsg7YDvIPGA8yD2gPgg-oEFIQqBDCEPgRchGYEbMRwRHZEfMSARIREikSQhJoExITaBODE5EToRO5FDMUQRRZFQMVERUpFdIWKBiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHWgeEh5oHzIfWCACICgg0iEoIfIiwiLoI5Ij9CQEJBQkJCQ8JFYkZCR0JIQklCSkJPQlBCUcJTYlRCVUJWQldCW0JcQl1CXkJfwmFiYkJjQmRCaxJsEm0SbhJvknEychJzEnQSdRJ2EncSeBJ5EnoSexJ8En2SfzKAEoESghKDEoQShRKGEocSiBKJEooSi5KNMo4SjxKQEsNCxELFQsZCx8LJYspCy0LMQs1CzkLPQtBC0ULSQtNC1ELVwtdi2ELZQtpC20LcQt1C3kLfQuBC4ULiQuPC5WLmQudC6ELvEvAS8RLyEvOS9SL2EvcS-BL5EvoS_hL_EwATAZMDMwQTBRMGEwcTCxMMEw0TDhMPkxEzEhMTExQTGoMnIymDNCM2g0EjRoNTI1WDYCNig20jcoN_I4GDg2OEQ4XDh2OIQ4lDisOMI46DmSOeg6sjrYOvI7GDsyO2g7gjuoPFI8qD1zPYE9mT2yPdg98j4oPkM-UT5pPrY-xD7UPuQ-_D8SP2hAc0CBQJlAs0DBQNFA6UFyQbhB0kIoQvZDBEMcQ8ZD1EPsRHhEkkToRbJF2EaCRqhG80cBRxFHIUc5R1JHqEhySJhJQkloShJKdEqESpRKpEq0SsRK1ErkSvRLBEsUSyRLZEt0S4RLnEu2S8RL1EvkS_RMNExETFRMZEx0TIRMlEykTLRMxE5k","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgItgjNCUYJVQllCXUJhQmdCbcJxQnVCeUJ9QoMCocKnAriCxgLZgt5C-cL9QwJDMMM1QztDVMNbA2iDdgOFg4pDoYOnQ-3D8wQIxA8EGIQmBDGENkRNxFJEoMSnRLzEwwTIhNYE4oT7xRWFGUUdRSFFJ0UtxTFFNUU5RT8FW8VyhXiFhgWNhZJFp4W9hcFFxkXsxfFF9wYPhiLGKIY2Bj6GUYZWRmmGbkakxqsGvMbDBtiG5gbuxwLHFQcaR1jHXwdyx4iHlgevh8CHxkgMyBMIJ4g4iEYIXohyiMKI1ojoiPYJCYkOCSKJNolfiXKJhImLCZiJpgm4yb5JzcnSSeHJ5koMyhNKIMonSjTKOkpIiwYLGYsfCy3LMwtBy0cLbYtzS4GLh0uVi5sLqIu2C8jLzgvii_bMHswyjESMSkxYjGYMfoySjOKM9o0IjRYNLs1AzUcNjY2STabNuI3GDc-N4430zfsOOY4-TlOOaI52Dn6OkM6XDqjOrw7ljupO_Y8CTxiPJg8szzMPRs9cz2FPZw-Nj5FPlk-uz8OPyI_WD-KP-9AU0BlQHVAhUCdQLdAxUDVQOVA-UFvQcpB4kIYQkNCXEK3QsxEBkQdRHZEiUSiRNhFE0UsRYNFnUa3RslHJkc5R2JHmEfjR_1IZ0h1SI1JR0lVSW1J10npSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYDaIN2BBiEJgRxhHcEg4TIhNYFEYUVBRkFHUUgRSZFLcUwRTVFOQU9BUNFeIWGBb2FwEXERcpF6MXuRfeGKIY2BmmGbkakxqkGrwbYhuYHFYcaR1jHY0eIh5YHwYfGSA7IOIhGCG2IcgjBiMcI6Ij2CRyJIglwiXYJmImmCcnJzEnSSiDKJEorSkiLBgspyy0LMwuBi4dLqIu2C9zMMsxYjGYMkoznjQiNFg09zUcNkY2WTbiNxg3wzfsOPY5CTmiOdg6kzqpO6c7uTxiPJg9dz2EPZQ9rD4mPj0-Xz8iP1hAQ0BRQGFAfUCeQLZAxEDVQOlBD0HiQhhDR0NZQ3NDiUSiRNhHYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC0YLVAtkC3QLhAuUC6QLtAvEC9wM1gzkDPQNBA0UDSQNNA1EDVQNbA2iDdgOAg6YD5IQKBBiEJgQwhFYElIS6BMiE1gTghQYFRIVqBXiFhgWQhZ4FpIW2BfSGBgYMhhoGKIY2BkCGTgZUhmYGpIa2BryGygbYhuYG8Mb0RvhG_kcExwhHDEcQRxZHVMdYR1xHYEdmR2zHcEd0R3pHiIeWCDiIRgjoiPYJmImmCkiLBguoi7YMWIxmDQiNFg24jcYN1Y3ZDd8N5Y3rDmiOdg6Ejo4OlI6aDxiPJg80jz4PRI9KD8iP1g_kz-hP7k_0z_pQeJCGESiRNhHYkeYSiJKWEziTSRNNE1ETVRNZE10TYRNlE2kTbRNxE3UTeRN9E4EThROJE40TkROVE5kTnROhE6UTqROtE7ETtRO5E70TwRPFE8kTzRPRE9UT2RPdE-ET5Q","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQxBEEEUQRhBHEEgQSRBKEEsQTBBNEE4QTxBQEFEQUhBTEFQQVRBZgIIghYCuILGA2iDdgQYhCYEc8R9hIMEyITWBRGFFQUZBR9FJ8UsxTBFNUU7RUOFeIWGBb2FwEXERcpF7cXwRfcGKIY2BmWGaQZuRqTGqQavRtiG5gcRhxpHWseIh5YHvYfGSA3IEQgXCDiIRghsiHIIwIjGCOiI9gkciSIJcIl2CZiJpgnJycxJ0kogyiZKSIsGCyvLM4uFi4tLqIu2C92L4gwxjDYMWIxmDIyMkgzgjOYNCI0WDTzNRw2NDZZNuI3GDfDN9k44jkJOaI52DqnOrw7ljuhO7k8YjyYPXM9hD2UPa0-Nj5EPlk_Ij9YQENAWUB3QIRAnEC2QM1A50DxQQlB4kIYQ0NDWUN7RKJE2EdiR5hKIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE3ETdRN5E30TgROFE4kTjRORE5UTmROdE6ETpROpE60TsRO1E7kTvRPBE8UTyRPNE9ET1RPZE90T4RPlA","BbEFwQXRBeEF8QYBBhEGIQYxBkEGUQZhBqEGsQbBBwEHEQchBzEHcQeBB5EHoQexB8EH0QfhB_EIAQhoCTIJWAoCCigK0gsoC_IMGAzCDOgNkg3oDhYOLA6yDtgPBg8cD4IPqA_mD_wQUhCoENIQ6BFyEZgRwhHYEkISaBKiErgTEhNoE5ITqBQzFEEUWRSCFJgVAxURFSkVYhV4FdIWKBZTFmkXQxdZGCMYORiSGOgZthnEGdwahhqUGqwbUhuoHHIcmB1CHWgeEh5oHzIfWCACICgg0iEoIfIiwiLoI5Ij9CQEJBQkJCQ8JFYkZCR0JIQklCSkJPQlBCUcJTYlRCVUJWQldCW0JcQl1CXkJfwmFiYkJjQmRCaxJsEm0SbhJvknEychJzEnQSdRJ2EncSeBJ5EnoSexJ8En2SfzKAEoESghKDEoQShRKGEocSiBKJEooSi5KNMo4SjxKQEsNCxELFQsZCx8LJYspCy0LMQs1CzkLPQtBC0ULSQtNC1ELVwtdi2ELZQtpC20LcQt1C3kLfQuBC4ULiQuPC5WLmQudC6ELvEvAS8RLyEvOS9SL2EvcS-BL5EvoS_hL_EwATAZMDMwQTBRMGEwcTCxMMEw0TDhMPkxEzEhMTExQTGoMnIymDNCM2g0EjRoNTI1WDYCNig20jcoN1Y3bDfyOBg4RjhcOMI46DkmOTw5kjnoOhI6KDqyOtg7AjsYO4I7qDviO_g8UjyoPNI86D1zPYE9mT3CPdg-Qz5RPmk-oj64PxI_aD-TP6lAg0CZQWNBeEHSQihC9kMEQxxDxkPUQ-xEkkToRbJF2EaCRqhHUkeoSHJImElCSWhKEkp0SoRKlEqkSrRKxErUSuRK9EsESxRLJEtkS3RLhEucS7ZLxEvUS-RL9Ew0TERMVExkTHRMhEyUTKRMtEzETmQ","AuEC8QMBAxEDIQMxA0EDUQNhA3EDgQORA6EDsQPBA9ED4QPxBAEEEQQhBDEEQQRRBGEEcQSBBJEEoQSxBMEE0QThBPEFAQURBSEFMQVBBVEFmAgiCFgK4gsYC4YLnAwGDBwMxgzcDUYNXA2iDdgOQg5YDsIO2A-CD5gQAhAYEGIQmBECERgRghGYEkISWBLCEtgTIhNYE8MT2RRDFFEUZBR0FIQUlBS8FQMVGRWDFZkV4hYYFyIXeBiiGNgZ4ho4G2IbmByjHLEc-R4iHlgg4iEYI6Ij2CZiJpgpIiviLBguoi7YMWIxmDQiNFg24jcYOaI52DpGOlw6xjrcO4Y7nDwGPBw8YjyYPQI9GD2CPZg-Qj5YPsI-2D8iP1g_wj_YQEJAWEECQRhBgkGYQeJCGEKCQphDAkMYQ8JD2ERCRFhEokTYRUNFWUXDRdlGg0aZRwNHGUdiR5hKIkpYTOJNJE00TURNVE1kTXRNhE2UTaRNtE3ETdRN5E30TgROFE4kTjRORE5UTmROdE6ETpROpE60TsRO1E7kTvRPBE8UTyRPNE9ET1RPZE90T4RPlA","ABEAIQAxAEEAUQBhAHEAgQCRAKEAsQDBANEA4QDxAQEBKAIyAkgDUgNoBHIEiAWSBagGsgbIB9IH6AjyCQgKEgooCzILSAxSDGgNcg2IDpIOqA-yD8gQ0hD0EQQRFBEkETQRRBFUEWQRhBGUEaQRtBHEEdQR5A","ABEAIQAxAEEAUQBhAHEAgQCRAKEAsQDBANEA4QDxAQEBKAIyAkgDUgNoA4YDlAOsA8cD3QQ2BEQEXARyBIgEogTIBVIFeAWSBagFwwXRBekGcwaBBpkGsgbIB9IH6AjyCQgJJgk0CUwJ1gnkCfwKEgooCkIKaAryCxgLMgtIC2MLcQuJDBMMIQw5DFIMaA1yDYgOkg6oD7IPyBDSEPQRBBEUESQRNBFEEVQRZBGEEZQRpBG0EcQR1BHk","ABEAIQAxAEEAUQBhAHEAgQCRAKEAsQDBANEA4QDxAQEBKAIyAkgCZgJ0AowDFgMkAzwDUgNoA4MDkQOpBDMEQQRZBHIEiAWSBagF5gX0BgQGFAYkBjQGRAZUBmQGfAayBsgHAwcRByEHMQdBB2EHcQeBB5kH0gfoCPIJCAoSCigLMgtIDFIMaA1yDYgOkg6oD7IPyBDSEPQRBBEUESQRNBFEEVQRZBGEEZQRpBG0EcQR1BHk","ABEAIQAxAEEAUQBhAHEAgQCRAKEAsQDBANEA4QDxAQEBKAIyAkgDUgNoA4YDlAOkA7QDzAQWBCQENAREBFwEcgSIBKMEsQTBBNEE6QUzBUEFUQVhBXkFkgWoBrIGyAfSB-gI8gkIChIKKApGClQKbAsyC0gLYwtxC4kMUgxoDXINiA6SDqgPsg_IENIQ9BEEERQRJBE0EUQRVBFkEYQRlBGkEbQRxBHUEeQ"]);
const ROOM_WALL_MAP = Object.freeze({"village":0,"meadow":1,"pollenwood":2,"grotto":3,"harbor":4,"coast":1,"glassreef":5,"bellcavern":6,"orchard":7,"reedroad":1,"forest":8,"mistmarsh":3,"moonvillage":9,"runepass":10,"ruins":11,"deepwood":12,"dunehamlet":13,"desert":14,"tower":15,"silkgully":16,"frosttown":17,"glacier":5,"mirrorlake":18,"auroraisle":19,"emberforge":20,"ashgarden":2,"volcano":21,"basaltgate":22,"observatory":23,"astralpass":5,"prismarchive":24,"tidevault":3,"astrumcity":7,"windviaduct":5,"cinderopera":25,"raincistern":26,"cloudstation":9,"cirrusgarden":5,"mossbasilica":27,"thornlabyrinth":12,"saltmarket":4,"coralisle":1,"dawnisle":5,"glassisle":6,"opalcity":23,"tempestisle":28,"orchidisle":2,"obsidiancrypt":19,"ferrumworks":20,"cinderisle":29,"sunforge":30,"abysslift":22,"saffronterrace":31,"cedarcanopy":5,"fernstation":32,"vermilliongate":3,"fulgurpass":33,"zephyrcauseway":1,"aurorafjord":18,"pelagicspire":3,"coralobservatory":4,"shelltown":1,"lunettecity":1,"meridianleague":34,"shinonomeport":4,"dawnshoal":1,"mistlighthouse":1,"tidecaves":3,"asanagicity":35,"mirrorpaddy":36,"whaleshrine":25,"kelpdeep":26,"wakamoevillage":7,"sproutdowns":2,"giantstump":1,"rootmaze":12,"shinkiroasis":13,"dunesea":37,"sunziggurat":38,"sandtomb":6,"hakuchucity":17,"saltflats":5,"prismgarden":2,"geodecave":19,"haehighland":9,"windmillroad":1,"kitecliff":39,"galecanyon":22,"shuutown":35,"rainforestpath":27,"thunderfalls":18,"floodcistern":3,"treetopvillage":40,"mossroad":41,"spiritcedar":1,"jukaideep":42,"akaneforge":20,"mapleslope":43,"lavaterrace":44,"magmavault":22,"haricity":17,"glassdunes":1,"mirrorhall":24,"crystalmine":16,"yuunagiport":4,"sunsetcape":45,"skybridge":5,"windtunnel":42,"tasogarevillage":9,"goldfield":2,"scarecrowhill":1,"harvestvault":46,"yoiharbor":35,"fireflyriver":1,"tidetemple":47,"abyssreef":3,"stardusttown":7,"meteorfield":48,"cometforge":49,"craterdepths":50,"geppakucity":17,"moonsnow":5,"auroragate":1,"icepalace":51,"zenithgate":7,"starstair":14,"twinmeridian":1,"zenithcrossing":52,"interior-village-1":53,"interior-village-2":54,"interior-village-3":55,"interior-harbor-1":53,"interior-harbor-2":54,"interior-harbor-3":55,"interior-orchard-1":53,"interior-orchard-2":54,"interior-orchard-3":55,"interior-moonvillage-1":53,"interior-moonvillage-2":54,"interior-moonvillage-3":55,"interior-dunehamlet-1":53,"interior-dunehamlet-2":54,"interior-dunehamlet-3":55,"interior-frosttown-1":53,"interior-frosttown-2":54,"interior-frosttown-3":55,"interior-emberforge-1":53,"interior-emberforge-2":54,"interior-emberforge-3":55,"interior-observatory-1":53,"interior-observatory-2":54,"interior-observatory-3":55,"interior-astrumcity-1":53,"interior-astrumcity-2":54,"interior-astrumcity-3":55,"interior-cloudstation-1":53,"interior-cloudstation-2":54,"interior-cloudstation-3":55,"interior-saltmarket-1":53,"interior-saltmarket-2":54,"interior-saltmarket-3":55,"interior-opalcity-1":53,"interior-opalcity-2":54,"interior-opalcity-3":55,"interior-ferrumworks-1":53,"interior-ferrumworks-2":54,"interior-ferrumworks-3":55,"interior-saffronterrace-1":53,"interior-saffronterrace-2":54,"interior-saffronterrace-3":55,"interior-fulgurpass-1":53,"interior-fulgurpass-2":54,"interior-fulgurpass-3":55,"interior-coralobservatory-1":53,"interior-coralobservatory-2":54,"interior-coralobservatory-3":55,"interior-shinonomeport-1":53,"interior-shinonomeport-2":54,"interior-shinonomeport-3":55,"interior-asanagicity-1":53,"interior-asanagicity-2":54,"interior-asanagicity-3":55,"interior-mirrorpaddy-1":54,"interior-mirrorpaddy-2":56,"interior-wakamoevillage-1":53,"interior-wakamoevillage-2":54,"interior-wakamoevillage-3":55,"interior-shinkiroasis-1":53,"interior-shinkiroasis-2":54,"interior-shinkiroasis-3":55,"interior-hakuchucity-1":53,"interior-hakuchucity-2":54,"interior-hakuchucity-3":55,"interior-haehighland-1":53,"interior-haehighland-2":54,"interior-haehighland-3":55,"interior-shuutown-1":53,"interior-shuutown-2":54,"interior-shuutown-3":55,"interior-treetopvillage-1":53,"interior-treetopvillage-2":54,"interior-treetopvillage-3":55,"interior-akaneforge-1":53,"interior-akaneforge-2":54,"interior-akaneforge-3":55,"interior-lavaterrace-1":54,"interior-lavaterrace-2":54,"interior-haricity-1":53,"interior-haricity-2":54,"interior-haricity-3":55,"interior-yuunagiport-1":53,"interior-yuunagiport-2":54,"interior-yuunagiport-3":55,"interior-tasogarevillage-1":53,"interior-tasogarevillage-2":54,"interior-tasogarevillage-3":55,"interior-yoiharbor-1":53,"interior-yoiharbor-2":54,"interior-yoiharbor-3":55,"interior-stardusttown-1":53,"interior-stardusttown-2":54,"interior-stardusttown-3":55,"interior-cometforge-1":54,"interior-cometforge-2":56,"interior-geppakucity-1":53,"interior-geppakucity-2":54,"interior-geppakucity-3":55,"interior-zenithgate-1":53,"interior-zenithgate-2":54,"interior-zenithgate-3":55,"interior-zenith-library":53,"interior-glitch":53});
export const WORLD_TTL = 15000;
const WORLD_INVITE_TTL = 60000;
const WORLD_INVITE_RETENTION = 120000;
const WORLD_RADIUS = 3;
const WORLD_PLAYER_ID = /^P[0-9a-f]{16}$/;
const WORLD_FIELDS = new Set(['map','x','y','facing','avatar','status']);
const WORLD_INVITE_FIELDS = new Set(['targetId','kind','roomCode','requestId']);
function worldName(value) {
  return [...String(value || '旅人').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim()].slice(0,32).join('') || '旅人';
}
function worldProfile(id,name,admin,avatar) {
  const role=adminRole(admin),isAdmin=!!role;
  return {id,name:adminDisplayName(worldName(name),admin),isAdmin,adminRole:role,
    avatar:role==='main'?'kasai':role==='sub'?'sub-admin':role==='sub-sub'?'sub-sub-admin':avatar==='female'?'female':'male'};
}
function worldActor(row) {
  return {...worldProfile(row.player_id,row.name,row.is_admin,row.avatar),map:row.map_id,x:row.x,y:row.y,facing:row.facing,status:row.status,updatedAt:row.updated_at};
}
async function validateWorldPresence(env,body) {
  let bounds=typeof body.map==='string'&&Object.hasOwn(WORLD_MAP_BOUNDS,body.map)?WORLD_MAP_BOUNDS[body.map]:null,layout=null;
  if(!bounds&&typeof body.map==='string'&&/^room:P[0-9a-f]{16}$/.test(body.map)) {
    const room=await roomRow(env,body.map.slice(5));
    if(room){layout=roomTemplateLayout(room.is_admin?'kasai':'secret',room.template_id);bounds=[layout.width,layout.height];}
  }
  if(Object.keys(body).some(key=>!WORLD_FIELDS.has(key))||!bounds||!integer(body.x,0,bounds[0]-1)||!integer(body.y,0,bounds[1]-1)||!['down','left','right','up'].includes(body.facing)||!['male','female'].includes(body.avatar)||!['idle','busy'].includes(body.status))fail(400,'INVALID_WORLD_PRESENCE','フィールドの位置・向き・状態が正しくありません。');
  if(layout&&layout.floorMask[body.y][body.x]!=='1')fail(400,'INVALID_WORLD_PRESENCE','部屋の床の上へ移動してください。');
  return body;
}

const ROOM_DIRECTIONS=Object.freeze({up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]});
export const ROOM_LAYOUTS=Object.freeze({
  secret:{width:18,height:16,spawn:{x:9,y:12},exit:{x:9,y:14},protected:[{x:8,y:0,width:2,height:16}]},
  kasai:{width:24,height:20,spawn:{x:12,y:16},exit:{x:12,y:18},protected:[{x:11,y:0,width:2,height:20},{x:8,y:2,width:8,height:6}]}
});
function roomFloorMask(layout,templateId='hall') {
  return Object.freeze(Array.from({length:layout.height},(_,y)=>Array.from({length:layout.width},(_,x)=>{
    if(x<1||y<1||x>layout.width-2||y>layout.height-2)return '0';
    if(templateId==='sanctum'){
      const inset=y<=4?7-y:y>=15?y-12:2;
      return x>=inset&&x<=23-inset?'1':'0';
    }
    if(templateId==='wings')return x>=7&&x<=16||y>=6&&y<=13?'1':'0';
    return '1';
  }).join('')));
}
export const ROOM_TEMPLATES=Object.freeze([
  {id:'hall',name:'王座の大広間',description:'広い長方形のホール。深緑の石床と金の装飾。'},
  {id:'sanctum',name:'星環の八角堂',description:'角を落とした八角形。青紫の石床と星の光。'},
  {id:'wings',name:'双翼の回廊',description:'左右へ広がる十字形。木床と若草色の庭園。'}
].map(template=>Object.freeze({...template,...ROOM_LAYOUTS.kasai,templateId:template.id,floorMask:roomFloorMask(ROOM_LAYOUTS.kasai,template.id)})));
const ROOM_TEMPLATE_MAP=new Map(ROOM_TEMPLATES.map(template=>[template.id,template]));
const ROOM_SECRET_FLOOR=roomFloorMask(ROOM_LAYOUTS.secret);
function roomTemplateId(value) {
  if(typeof value!=='string'||!ROOM_TEMPLATE_MAP.has(value))fail(400,'INVALID_ROOM_TEMPLATE','部屋の形は3種類のテンプレートから選んでください。');
  return value;
}
function roomTemplateLayout(kind,templateId='hall') {
  if(kind==='secret')return {...ROOM_LAYOUTS.secret,templateId:'hall',floorMask:ROOM_SECRET_FLOOR};
  const template=ROOM_TEMPLATE_MAP.get(templateId);
  if(kind!=='kasai'||!template)fail(400,'INVALID_ROOM_TEMPLATE','部屋の形を確認してください。');
  return {...ROOM_LAYOUTS.kasai,templateId:template.id,floorMask:template.floorMask};
}
export const ROOM_CATALOG=Object.freeze([
  {id:'plant',name:'観葉植物',width:1,height:1,solid:true},
  {id:'lamp',name:'星あかりランプ',width:1,height:1,solid:true},
  {id:'stool',name:'木のスツール',width:1,height:1,solid:true},
  {id:'table',name:'旅人のテーブル',width:2,height:2,solid:true},
  {id:'sofa',name:'海色のソファ',width:2,height:1,solid:true},
  {id:'shelf',name:'冒険の本棚',width:2,height:1,solid:true},
  {id:'bed',name:'ふかふかベッド',width:2,height:3,solid:true},
  {id:'aquarium',name:'小さな水族館',width:2,height:1,solid:true},
  {id:'crystal',name:'記憶のクリスタル',width:1,height:1,solid:true},
  {id:'plush',name:'パチモンぬいぐるみ',width:1,height:1,solid:true},
  {id:'rug',name:'星環のラグ',width:2,height:2,solid:false},
  {id:'banner',name:'旅団の旗',width:1,height:1,solid:true}
]);
const ROOM_ITEMS=new Map(ROOM_CATALOG.map(item=>[item.id,item]));
const ROOM_WALL_CACHE=new Map();
function roomWallCells(map) {
  if(!Object.hasOwn(ROOM_WALL_MAP,map))return null;
  const group=ROOM_WALL_MAP[map];
  if(!ROOM_WALL_CACHE.has(group)){
    const bytes=decodeURL(ROOM_WALL_GROUPS[group]),cells=new Map();
    for(let i=0;i<bytes.length;i+=2){const packed=(bytes[i]<<8)|bytes[i+1];cells.set(packed>>4,packed&15);}
    ROOM_WALL_CACHE.set(group,cells);
  }
  return ROOM_WALL_CACHE.get(group);
}
export function worldRoomWalls(map) {
  const cells=typeof map==='string'?roomWallCells(map):null,width=WORLD_MAP_BOUNDS[map]?.[0];
  return cells?[...cells].map(([index,mask])=>({x:index%width,y:Math.floor(index/width),facings:Object.keys(ROOM_DIRECTIONS).filter((_,i)=>mask&(1<<i))})):[];
}
function roomEntrance(body) {
  const bounds=typeof body.map==='string'&&Object.hasOwn(WORLD_MAP_BOUNDS,body.map)?WORLD_MAP_BOUNDS[body.map]:null;
  const direction=Object.keys(ROOM_DIRECTIONS).indexOf(body.facing);
  if(!bounds||!integer(body.x,0,bounds[0]-1)||!integer(body.y,0,bounds[1]-1)||direction<0||!((roomWallCells(body.map)?.get(body.y*bounds[0]+body.x)||0)&(1<<direction)))fail(400,'INVALID_ROOM_ENTRANCE','通り道に面した壁を選んでください。既存の出入口や人物の前には作れません。');
  return {map:body.map,x:body.x,y:body.y,facing:body.facing};
}
function roomName(value) {
  const name=safeName(value).replace(/[\u202a-\u202e\u2066-\u2069]/g,'').trim();
  if(!name)fail(400,'INVALID_ROOM_NAME','部屋の名前を1〜32文字で入力してください。');
  return name;
}
const ROOM_DEFAULT_NAMES=Object.freeze({1:'カサイのひみつ部屋',2:'サカイのひみつ部屋',3:'イサカのひみつ部屋'});
function effectiveRoomName(name,seat) {
  // Older clients submitted this exact generated name for every operator.
  // Repair only that alias; all other explicit names remain player-authored.
  return (seat===2||seat===3)&&name===ROOM_DEFAULT_NAMES[1]?ROOM_DEFAULT_NAMES[seat]:name;
}
export function validateRoomDecorations(input,kind='secret',templateId='hall') {
  const layout=roomTemplateLayout(kind,templateId);
  if(!layout||!Array.isArray(input)||input.length>32)fail(400,'INVALID_ROOM_DECORATIONS','模様替えアイテムは32個まで配置できます。');
  const ids=new Set(),occupied=new Set();
  return input.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['id','itemId','x','y','rotation'].includes(key))||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(value.id)||ids.has(value.id)||typeof value.itemId!=='string'||!ROOM_ITEMS.has(value.itemId)||![0,90,180,270].includes(value.rotation))fail(400,'INVALID_ROOM_DECORATIONS','アイテムの種類・識別情報・向きを確認してください。');
    const item=ROOM_ITEMS.get(value.itemId),turned=value.rotation===90||value.rotation===270,width=turned?item.height:item.width,height=turned?item.width:item.height;
    if(!integer(value.x,1,layout.width-1-width)||!integer(value.y,2,layout.height-2-height))fail(400,'INVALID_ROOM_DECORATIONS','アイテムは部屋の床の内側に配置してください。');
    for(let y=value.y;y<value.y+height;y++)for(let x=value.x;x<value.x+width;x++){
      const cell=x+','+y;
      if(layout.floorMask[y][x]!=='1')fail(400,'ROOM_DECORATION_BLOCKED','アイテム全体が部屋の床に収まる位置を選んでください。');
      if(occupied.has(cell)||layout.protected.some(rect=>x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height))fail(400,'ROOM_DECORATION_BLOCKED','アイテムを重ねたり、出入口・中央の通り道・カサイの舞台に置いたりすることはできません。');
      occupied.add(cell);
    }
    ids.add(value.id);return {id:value.id,itemId:value.itemId,x:value.x,y:value.y,rotation:value.rotation};
  });
}
const ROOM_SELECT=`SELECT r.*,p.name AS owner_name,(SELECT a.singleton FROM admin_members a WHERE a.player_id=r.owner_id) AS is_admin,
  (SELECT a.claimed_at FROM admin_members a WHERE a.player_id=r.owner_id) AS admin_claimed_at
  FROM world_rooms r JOIN players p ON p.id=r.owner_id`;
async function roomRow(env,id) {return env.DB.prepare(ROOM_SELECT+' WHERE r.owner_id=?').bind(id).first();}
function roomView(row) {
  if(!row)return null;
  const kind=row.is_admin?'kasai':'secret',layout=roomTemplateLayout(kind,row.template_id),direction=ROOM_DIRECTIONS[row.facing],decorations=[];
  // A role change can shrink the room or reserve its stage. Keep its permanent
  // doorway and stored design; expose only placements valid in today's layout.
  for(const item of JSON.parse(row.decorations_json)){
    try{validateRoomDecorations([...decorations,item],kind,layout.templateId);decorations.push(item);}catch(_){}
  }
  return {id:row.owner_id,mapId:'room:'+row.owner_id,owner:worldProfile(row.owner_id,row.owner_name,row.is_admin,'male'),kind,name:effectiveRoomName(row.name,row.is_admin),
    entrance:{map:row.map_id,x:row.entrance_x,y:row.entrance_y,facing:row.facing,returnX:row.entrance_x-direction[0],returnY:row.entrance_y-direction[1]},
    ...layout,decorations,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};
}
function roomDecorationUpdate(row,input,templateId) {
  const stored=JSON.parse(row.decorations_json),kind=row.is_admin?'kasai':'secret';
  if(input===undefined){
    // Renaming a room must not erase furniture hidden by a role change.
    if(templateId!==row.template_id)validateRoomDecorations(stored,kind,templateId);
    return stored;
  }
  const decorations=validateRoomDecorations(input,kind,templateId);
  if(row.is_admin)return decorations;
  const visibleIds=new Set(roomView(row).decorations.map(item=>item.id)),retained=stored.filter(item=>!visibleIds.has(item.id));
  if(!retained.length)return decorations;
  if(decorations.length+retained.length>32)fail(400,'INVALID_ROOM_DECORATIONS','保存されている家具を含めて32個まで配置できます。');
  const ids=new Set(retained.map(item=>item.id)),occupied=new Set();
  for(const value of retained){
    const item=ROOM_ITEMS.get(value.itemId),turned=value.rotation===90||value.rotation===270,width=turned?item.height:item.width,height=turned?item.width:item.height;
    for(let y=value.y;y<value.y+height;y++)for(let x=value.x;x<value.x+width;x++)occupied.add(x+','+y);
  }
  for(const value of decorations){
    const item=ROOM_ITEMS.get(value.itemId),turned=value.rotation===90||value.rotation===270,width=turned?item.height:item.width,height=turned?item.width:item.height;
    if(ids.has(value.id))fail(400,'ROOM_DECORATION_BLOCKED','保存されている家具と同じ識別情報は使えません。');
    for(let y=value.y;y<value.y+height;y++)for(let x=value.x;x<value.x+width;x++)if(occupied.has(x+','+y))fail(400,'ROOM_DECORATION_BLOCKED','保存されている家具と重ならない位置を選んでください。');
  }
  return [...decorations,...retained];
}
async function currentKasaiRoom(env, playerId = null) {
  const sql = ROOM_SELECT+' JOIN admin_members a ON a.player_id=r.owner_id';
  return playerId ? env.DB.prepare(sql+' WHERE a.player_id=?').bind(playerId).first() : env.DB.prepare(sql+' ORDER BY a.singleton LIMIT 1').first();
}
async function requireRoomEntrancePresence(env,playerId,entrance,now) {
  const direction=ROOM_DIRECTIONS[entrance.facing],presence=await env.DB.prepare('SELECT map_id,x,y,facing,updated_at FROM world_presence WHERE player_id=?').bind(playerId).first();
  if(!presence||presence.updated_at<=now-WORLD_TTL||presence.map_id!==entrance.map||presence.x!==entrance.x-direction[0]||presence.y!==entrance.y-direction[1]||presence.facing!==entrance.facing)fail(409,'ROOM_NOT_NEARBY','部屋の入口にしたい壁の前に立ち、その壁を向いてください。');
}
async function roomsRoute(request,env,path,method,player) {
  const now=Date.now(),url=new URL(request.url);
  if(path==='/api/world/rooms/catalog'&&method==='GET')return {catalog:ROOM_CATALOG,layouts:ROOM_LAYOUTS,templates:ROOM_TEMPLATES,serverTime:now};
  if(path==='/api/world/rooms/walls'&&method==='GET'){
    const map=url.searchParams.get('map');
    if(!map||!Object.hasOwn(WORLD_MAP_BOUNDS,map))fail(400,'INVALID_ROOM_MAP','部屋を作るフィールドを指定してください。');
    return {walls:worldRoomWalls(map),serverTime:now};
  }
  if(path==='/api/world/rooms/kasai'&&method==='GET'){
    const target=url.searchParams.has('playerId')?adminPlayerId(url.searchParams.get('playerId')):player.is_admin?player.id:null;
    return {room:roomView(await currentKasaiRoom(env,target)),serverTime:now};
  }
  if(path==='/api/world/rooms/mine'&&method==='GET')return {room:roomView(await roomRow(env,player.id)),serverTime:now};
  if(path==='/api/world/rooms'&&method==='GET'){
    if(url.searchParams.get('kind')==='kasai'){
      const rows=await env.DB.prepare(ROOM_SELECT+' JOIN admin_members a ON a.player_id=r.owner_id ORDER BY a.singleton').all();
      return {rooms:rows.results.map(roomView),serverTime:now};
    }
    const map=url.searchParams.get('map');
    if(!map||!Object.hasOwn(WORLD_MAP_BOUNDS,map))fail(400,'INVALID_ROOM_MAP','出入口を確認するフィールドを指定してください。');
    const rows=await env.DB.prepare(ROOM_SELECT+' WHERE r.map_id=? ORDER BY r.created_at,r.owner_id LIMIT 400').bind(map).all();
    return {rooms:rows.results.map(roomView),serverTime:now};
  }
  if(path==='/api/world/rooms'&&method==='POST'){
    await requireNoLiveSession(env,player.id,now);
    const body=await bodyJSON(request);
    if(Object.keys(body).some(key=>!['map','x','y','facing','name'].includes(key)))fail(400,'INVALID_ROOM_ENTRANCE','部屋の入口の指定が正しくありません。');
    const entrance=roomEntrance(body),name=effectiveRoomName(roomName(body.name===undefined?(ROOM_DEFAULT_NAMES[player.is_admin]||'ひみつの部屋'):body.name),player.is_admin),existing=await roomRow(env,player.id);
    if(existing){
      if(existing.map_id!==entrance.map||existing.entrance_x!==entrance.x||existing.entrance_y!==entrance.y||existing.facing!==entrance.facing)fail(409,'ROOM_ALREADY_EXISTS','ひみつの部屋はひとり一つです。別の壁へ移すときは移転してください。');
      return {room:roomView(existing),serverTime:now};
    }
    await requireRoomEntrancePresence(env,player.id,entrance,now);
    await consumeLimit(env,request,`world-room-create:${player.id}`,10,60000,true);
    await env.DB.prepare('INSERT OR IGNORE INTO world_rooms (owner_id,map_id,entrance_x,entrance_y,facing,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(player.id,entrance.map,entrance.x,entrance.y,entrance.facing,name,now,now).run();
    const created=await roomRow(env,player.id);
    if(!created)fail(409,'ROOM_ENTRANCE_OCCUPIED','この壁には別の人の部屋があります。別の壁を選んでください。');
    if(created.map_id!==entrance.map||created.entrance_x!==entrance.x||created.entrance_y!==entrance.y||created.facing!==entrance.facing)fail(409,'ROOM_ALREADY_EXISTS','別の操作で自分の部屋が作成されました。自分の部屋を開いてください。');
    return {room:roomView(created),serverTime:now};
  }
  const match=/^\/api\/world\/rooms\/(P[0-9a-f]{16})(?:\/(relocate))?$/.exec(path);
  if(!match)fail(404,'ROOM_NOT_FOUND','この部屋は見つかりません。');
  const id=match[1],row=await roomRow(env,id);
  if(!row)fail(404,'ROOM_NOT_FOUND','この部屋は見つかりません。');
  if(method==='GET'&&!match[2])return {room:roomView(row),serverTime:now};
  if(match[2]==='relocate'&&method==='POST'){
    if(id!==player.id)fail(403,'ROOM_OWNER_REQUIRED','部屋の持ち主だけが移転できます。');
    await requireNoLiveSession(env,player.id,now);
    const body=await bodyJSON(request);
    if(Object.keys(body).some(key=>!['revision','map','x','y','facing'].includes(key))||!integer(body.revision,1,1000000000))fail(400,'INVALID_ROOM_UPDATE','移転先と部屋の版番号を確認してください。');
    const entrance=roomEntrance(body);
    await requireRoomEntrancePresence(env,player.id,entrance,now);
    const changed=await env.DB.prepare(`UPDATE world_rooms SET map_id=?,entrance_x=?,entrance_y=?,facing=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=?
      AND NOT EXISTS(SELECT 1 FROM world_rooms other WHERE other.map_id=? AND other.entrance_x=? AND other.entrance_y=? AND other.owner_id<>?)
      AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id=?)
      AND EXISTS(SELECT 1 FROM players p WHERE p.id=? AND EXISTS(SELECT 1 FROM admin_members a WHERE a.player_id=p.id)=?)
      RETURNING owner_id`).bind(entrance.map,entrance.x,entrance.y,entrance.facing,now,player.id,body.revision,entrance.map,entrance.x,entrance.y,player.id,player.id,player.id,row.is_admin?1:0).first();
    if(!changed){
      await requireNoLiveSession(env,player.id,now);
      const occupied=await env.DB.prepare('SELECT owner_id FROM world_rooms WHERE map_id=? AND entrance_x=? AND entrance_y=? AND owner_id<>?').bind(entrance.map,entrance.x,entrance.y,player.id).first();
      if(occupied)fail(409,'ROOM_ENTRANCE_OCCUPIED','この壁には別の人の部屋があります。');
      fail(409,'ROOM_CHANGED','部屋が変更されました。最新の部屋を読み込み直してください。');
    }
    return {room:roomView(await roomRow(env,player.id)),serverTime:now};
  }
  if(method!=='PATCH'||match[2])fail(405,'METHOD_NOT_ALLOWED','この部屋の操作方法には対応していません。');
  if(id!==player.id)fail(403,'ROOM_OWNER_REQUIRED','部屋の持ち主だけが模様替えできます。');
  await requireNoLiveSession(env,player.id,now);
  const body=await bodyJSON(request);
  if(Object.keys(body).some(key=>!['revision','name','decorations','templateId'].includes(key))||!integer(body.revision,1,1000000000)||body.name===undefined&&body.decorations===undefined&&body.templateId===undefined)fail(400,'INVALID_ROOM_UPDATE','模様替えの内容と版番号を確認してください。');
  if(body.templateId!==undefined&&!row.is_admin)fail(403,'ROOM_TEMPLATE_ADMIN_REQUIRED','部屋の形を変更できるのは、現在登録されている運営本人だけです。');
  const templateId=body.templateId===undefined?row.template_id:roomTemplateId(body.templateId);
  const name=body.name===undefined?row.name:effectiveRoomName(roomName(body.name),row.is_admin),decorations=roomDecorationUpdate(row,body.decorations,templateId);
  await consumeLimit(env,request,`world-room-edit:${player.id}`,60,60000,true);
  const changed=await env.DB.prepare(`UPDATE world_rooms SET name=?,decorations_json=?,template_id=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=?
    AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id=world_rooms.owner_id)
    AND EXISTS(SELECT 1 FROM players p WHERE p.id=? AND EXISTS(SELECT 1 FROM admin_members a WHERE a.player_id=p.id)=?)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM admin_members a WHERE a.player_id=world_rooms.owner_id AND a.claimed_at=?)) RETURNING owner_id`)
    .bind(name,JSON.stringify(decorations),templateId,now,player.id,body.revision,player.id,row.is_admin?1:0,row.admin_claimed_at,row.admin_claimed_at).first();
  if(!changed)fail(409,'ROOM_CHANGED','部屋が変更されました。最新の模様替えを読み込み直してください。');
  return {room:roomView(await roomRow(env,player.id)),serverTime:now};
}

const KASAI_TTL=30*60*1000;
function kasaiReceipt(row) {
  return row?{id:row.receipt_id,grantId:row.receipt_id,species:'floravelle',level:70,gender:row.gender,createdAt:row.created_at,ackedAt:row.acked_at,delivered:row.acked_at!==null}:null;
}
async function kasaiReward(env,playerId) {return env.DB.prepare('SELECT r.*,COALESCE(c.room_owner_id,l.kasai_id) AS challenge_room_owner_id FROM kasai_rewards r LEFT JOIN kasai_challenges c ON c.id=r.challenge_id LEFT JOIN kasai_live_sessions l ON l.id=r.live_session_id WHERE r.player_id=?').bind(playerId).first();}
async function requireKasaiChallenger(env,player,roomOwnerId=null) {
  if(player.is_admin||roomOwnerId===player.id||await adminRecord(env,player.id))fail(403,'KASAI_SELF_BATTLE','運営のカサイは自分自身とバトルできません。');
}
async function currentKasaiParty(env, playerId = null) {
  const sql='SELECT k.* FROM kasai_parties k JOIN admin_members a ON a.player_id=k.player_id';
  return playerId ? env.DB.prepare(sql+' WHERE a.player_id=?').bind(playerId).first() : env.DB.prepare(sql+' ORDER BY a.singleton LIMIT 1').first();
}
function kasaiOpponents(row) {
  return row.opponents_json?JSON.parse(row.opponents_json):row.rules_version===KASAI_LEGACY_RULES_VERSION?KASAI_TEAM:null;
}
function kasaiRulesSupported(row) {
  return row.rules_version===KASAI_RULES_VERSION&&!!row.opponents_json||row.rules_version===KASAI_LEGACY_RULES_VERSION&&!row.opponents_json;
}
async function requireKasaiChallengeRules(env,row,now) {
  if(kasaiRulesSupported(row))return;
  await env.DB.prepare("UPDATE kasai_challenges SET state='expired',completed_at=? WHERE id=? AND player_id=? AND state='pending'").bind(now,row.id,row.player_id).run();
  fail(409,'KASAI_CHALLENGE_FINISHED','対戦ルールが更新されました。フィールドのカサイ本人にもう一度話しかけて、新しい対戦を始めてください。');
}
function kasaiStorage(value) {
  if(!integer(value,0,192))fail(400,'INVALID_KASAI_CAPACITY','ひかえの人数を確認してください。');
  return value;
}
async function kasaiToken(env,row) {
  if(typeof env.DUEL_SIGNING_KEY!=='string'||env.DUEL_SIGNING_KEY.length<32)fail(503,'KASAI_NOT_CONFIGURED','カサイへの挑戦を準備中です。');
  const payload=encoder.encode(JSON.stringify({kind:'kasai-challenge',v:1,id:row.id,playerId:row.player_id,seed:row.seed,rulesVersion:row.rules_version,expiresAt:row.expires_at}));
  return encodeURL(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env),payload)));
}
async function kasaiChallengeView(env,row) {
  const token=await kasaiToken(env,row);
  return {challenge:{id:row.id,roomId:row.room_owner_id,seed:row.seed,rulesVersion:row.rules_version,party:JSON.parse(row.party_json),opponents:kasaiOpponents(row),expiresAt:row.expires_at,state:row.state},token};
}
async function kasaiOwnedParty(env,party,player) {
  let reserve,addition;
  for(const mon of party){
    if(mon.battleGrowth!==undefined&&(!integer(mon.level,1,100)||!integer(mon.battleGrowth,0,Math.min(99,mon.level-1))))
      fail(400,'INVALID_KASAI_PARTY','戦闘で育った能力の記録を確認してください。');
    if(!mon.grantId){
      if(mon.customStats||mon.customMoves)fail(403,'KASAI_PARTY_NOT_OWNED','特別な能力を持つフートの受け取り記録を確認できません。');
      continue;
    }
    if(mon.species==='futo'){
      const grant=await env.DB.prepare('SELECT config_json FROM grants WHERE player_id=? AND grant_id=?').bind(player.id,mon.grantId).first();
      if(!grant)fail(403,'KASAI_PARTY_NOT_OWNED','挑戦するフートの受け取り記録を確認できません。');
      const config=validateConfig(JSON.parse(grant.config_json));
      if(mon.customStats&&(Object.entries(config.stats).some(([key,value])=>mon.customStats[key]!==value)||mon.customStatsLevel<config.level)||mon.customMoves&&JSON.stringify(mon.customMoves)!==JSON.stringify(config.moves))fail(403,'KASAI_PARTY_CHANGED','フートの能力が配布記録と一致しません。配布情報を同期してから挑戦してください。');
    }else if(mon.grantId===`kasai-reward:${player.id}`&&mon.species==='floravelle'){
      const receipt=await kasaiReward(env,player.id);
      if(!receipt||receipt.gender!==mon.gender)fail(403,'KASAI_PARTY_NOT_OWNED','キラシードの受け取り記録を確認できません。');
    }else if(mon.grantId.startsWith('admin-trained-v64:')||mon.grantId.startsWith('admin-galdogran-v68:')){
      const isAddition=mon.grantId.startsWith('admin-galdogran-v68:');
      // Stopping new sub-admin deliveries does not revoke legacy holdings.
      // These stable receipts remain valid only for their actual role/owner.
      if(isAddition){if(addition===undefined)addition=await adminReserveAddition(env,player.id,{delivery:false});}
      else if(reserve===undefined)reserve=await adminReserveTeam(env,player.id,{delivery:false});
      const member=(isAddition?addition:reserve)?.members.find(item=>item.grantId===mon.grantId&&item.species===mon.species);
      if(!player.is_admin||!member)fail(403,'KASAI_PARTY_NOT_OWNED','この育成済みメンバーは、登録された運営本人だけが使用できます。');
      const genderMatches=member.gender==='none'?member.species==='lunaxion'&&mon.species==='lunaxion'&&mon.gender===undefined:mon.gender===member.gender;
      if(mon.level!==member.level||!genderMatches||mon.bonusPoints!==member.bonusPoints||(!isAddition&&mon.battleGrowth!==member.battleGrowth)||mon.customStats||mon.customMoves)fail(403,'KASAI_PARTY_CHANGED','育成済みメンバーのレベル・性別・育成記録が一致しません。');
      // The original six have their authoritative Lv1-to-100 growth restored
      // by normalizeKasaiParty, including records issued before that field existed.
      // HP, PP, nickname, allocated points and held items may legitimately
      // change after delivery. normalizeKasaiParty enforces their game limits.
    }else if(player.is_admin&&['arvelion','floravelle'].includes(mon.species)&&mon.grantId===`admin-${mon.species==='arvelion'?'legendary':'mythical'}:${player.id}`){
      if(!await adminRecord(env,player.id))fail(403,'KASAI_PARTY_NOT_OWNED','運営の初期メンバーの受け取り記録を確認できません。');
    }else fail(403,'KASAI_PARTY_NOT_OWNED','挑戦する仲間の受け取り記録を確認できません。');
  }
}
async function kasaiRoute(request,env,path,method,player) {
  if(path==='/api/world/kasai/live'||path.startsWith('/api/world/kasai/live/'))return kasaiLiveRoute(request,env,path,method,player);
  const now=Date.now();
  if(path==='/api/world/kasai/party'&&method==='GET'){
    const url=new URL(request.url),target=url.searchParams.has('playerId')?adminPlayerId(url.searchParams.get('playerId')):player.is_admin?player.id:null;
    const row=await currentKasaiParty(env,target);
    return {party:row?normalizeKasaiParty(JSON.parse(row.party_json)):null,playerId:row?.player_id||null,updatedAt:row?.updated_at||null,serverTime:now};
  }
  if(path==='/api/world/kasai/party'&&method==='POST'){
    const registration=await requireAdmin(env,player);
    const body=await bodyJSON(request);
    if(Object.keys(body).some(key=>key!=='party'))fail(400,'INVALID_KASAI_PARTY','運営の手持ちの情報を確認してください。');
    let party;try{party=normalizeKasaiParty(body.party);}catch(_){fail(400,'INVALID_KASAI_PARTY','運営の手持ちは1〜6体で設定してください。');}
    await kasaiOwnedParty(env,party,player);
    const partyJSON=JSON.stringify(party);
    await consumeLimit(env,request,`world-kasai-party:${player.id}`,120,60000,true);
    const saved=await env.DB.prepare(`INSERT INTO kasai_parties (player_id,party_json,updated_at)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM admin_members WHERE player_id=? AND claimed_at=?)
      ON CONFLICT(player_id) DO UPDATE SET party_json=excluded.party_json,updated_at=CASE WHEN kasai_parties.party_json=excluded.party_json THEN kasai_parties.updated_at ELSE excluded.updated_at END
      RETURNING player_id,party_json,updated_at`).bind(player.id,partyJSON,now,player.id,registration.claimed_at).first();
    const current=await requireAdmin(env,player);
    if(current.claimed_at!==registration.claimed_at)fail(403,'ADMIN_REQUIRED','運営登録が変更されました。最新の状態で操作してください。');
    if(!saved)fail(409,'KASAI_PARTY_CHANGED','運営の手持ちが変更されました。もう一度同期してください。');
    return {party:JSON.parse(saved.party_json),playerId:saved.player_id,updatedAt:saved.updated_at,serverTime:now};
  }
  if(path==='/api/world/kasai/reward'&&method==='GET'){
    const reward=await kasaiReward(env,player.id);
    await requireKasaiChallenger(env,player,reward?.challenge_room_owner_id);
    const pending=!reward?await env.DB.prepare("SELECT id FROM kasai_live_sessions WHERE challenger_id=? AND kasai_id<>challenger_id AND state IN ('result','closed') AND json_extract(battle_json,'$.winner')=0 ORDER BY updated_at DESC,id DESC LIMIT 1").bind(player.id).first():null;
    return {receipt:kasaiReceipt(reward),pendingLiveSessionId:pending?.id||null,serverTime:now};
  }
  if(path==='/api/world/kasai/reward/ack'&&method==='POST'){
    const reward=await kasaiReward(env,player.id);
    await requireKasaiChallenger(env,player,reward?.challenge_room_owner_id);
    const body=await bodyJSON(request),expected=`kasai-reward:${player.id}`;
    if(Object.keys(body).some(key=>key!=='receiptId')||body.receiptId!==expected)fail(400,'INVALID_KASAI_RECEIPT','カサイの報酬の受取記録を確認してください。');
    const result=await env.DB.prepare(`UPDATE kasai_rewards SET acked_at=COALESCE(acked_at,?) WHERE player_id=? AND receipt_id=?
      AND NOT EXISTS(SELECT 1 FROM admin_members WHERE player_id=?)
      AND (EXISTS(SELECT 1 FROM kasai_challenges c WHERE c.id=kasai_rewards.challenge_id AND c.room_owner_id<>c.player_id) OR EXISTS(SELECT 1 FROM kasai_live_sessions l WHERE l.id=kasai_rewards.live_session_id AND l.challenger_id=kasai_rewards.player_id AND l.kasai_id<>l.challenger_id AND json_extract(l.battle_json,'$.winner')=0))
      RETURNING player_id`).bind(now,player.id,expected,player.id).first();
    await requireKasaiChallenger(env,player,reward?.challenge_room_owner_id);
    if(!result)fail(404,'KASAI_REWARD_NOT_FOUND','カサイの報酬はまだ受け取っていません。');
    return {receipt:kasaiReceipt(await kasaiReward(env,player.id)),serverTime:now};
  }
  if(path==='/api/world/kasai/challenges'&&method==='POST'){
    const body=await bodyJSON(request);kasaiStorage(body.storageCount);
    if(Object.keys(body).some(key=>!['requestId','roomId','party','storageCount'].includes(key))||typeof body.requestId!=='string'||!UUID.test(body.requestId)||typeof body.roomId!=='string'||!WORLD_PLAYER_ID.test(body.roomId))fail(400,'INVALID_KASAI_CHALLENGE','カサイへの挑戦情報を確認してください。');
    await requireKasaiChallenger(env,player,body.roomId);
    let party;try{party=normalizeKasaiParty(body.party);}catch(_){fail(400,'INVALID_KASAI_PARTY','挑戦する仲間の情報が正しくありません。');}
    const partyJSON=JSON.stringify(party),requestId=body.requestId.toLowerCase();
    const previous=await env.DB.prepare('SELECT * FROM kasai_challenges WHERE player_id=? AND request_id=?').bind(player.id,requestId).first();
    if(previous){
      if(previous.state==='pending')await requireKasaiChallengeRules(env,previous,now);
      if(previous.room_owner_id!==body.roomId||previous.party_json!==partyJSON)fail(409,'KASAI_REQUEST_REUSED','同じ挑戦の識別情報を別の仲間で使うことはできません。');
      if(previous.state!=='pending'||previous.expires_at<=now)fail(409,'KASAI_CHALLENGE_FINISHED','この挑戦は終了しています。もう一度カサイに話しかけてください。');
      return {...await kasaiChallengeView(env,previous),rewardClaimed:!!await kasaiReward(env,player.id),serverTime:now};
    }
    fail(409,'KASAI_LIVE_REQUIRED','カサイ本人がいるフィールドで話しかけて、本人との対戦を申し込んでください。');
  }
  const match=/^\/api\/world\/kasai\/challenges\/([0-9a-f-]+)\/(complete|cancel)$/.exec(path);
  if(!match||method!=='POST'||!UUID.test(match[1]))fail(404,'KASAI_CHALLENGE_NOT_FOUND','このカサイへの挑戦は見つかりません。');
  const [,id,operation]=match,body=await bodyJSON(request),row=await env.DB.prepare('SELECT * FROM kasai_challenges WHERE id=? AND player_id=?').bind(id,player.id).first();
  if(!row)fail(404,'KASAI_CHALLENGE_NOT_FOUND','このカサイへの挑戦は見つかりません。');
  if(Object.keys(body).some(key=>!(operation==='cancel'?['token']:['token','actions','storageCount']).includes(key))||typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token)||!await sameSecret(await digest(body.token),row.token_hash))fail(403,'INVALID_KASAI_TOKEN','カサイへの挑戦情報が一致しません。');
  if(operation==='cancel'){
    await env.DB.prepare("UPDATE kasai_challenges SET state='cancelled',completed_at=? WHERE id=? AND player_id=? AND state='pending'").bind(now,id,player.id).run();
    return {cancelled:true,serverTime:now};
  }
  await requireKasaiChallenger(env,player,row.room_owner_id);
  if(row.state==='pending')await requireKasaiChallengeRules(env,row,now);
  const storageCount=kasaiStorage(body.storageCount);
  if(!Array.isArray(body.actions)||body.actions.length<1||body.actions.length>KASAI_MAX_ACTIONS)fail(400,'INVALID_KASAI_TRANSCRIPT','バトルの操作記録を確認してください。');
  const resultHash=await digest(JSON.stringify(body.actions));
  if(row.state==='won'||row.state==='lost'){
    if(row.result_hash!==resultHash)fail(409,'KASAI_RESULT_CHANGED','確定済みのバトルと操作記録が一致しません。');
    if(row.state==='won'&&storageCount>=192)fail(409,'KASAI_STORAGE_FULL','ひかえが192体で満員です。報酬を受け取るには空きを作ってください。');
    return {won:row.state==='won',result:row.state,receipt:row.state==='won'?kasaiReceipt(await kasaiReward(env,player.id)):null,serverTime:now};
  }
  if(row.state!=='pending'||row.expires_at<=now)fail(409,'KASAI_CHALLENGE_FINISHED','この挑戦は終了、または期限切れです。もう一度カサイに挑戦してください。');
  await consumeLimit(env,request,`world-kasai-result:${player.id}`,30,60000,true);
  let replay;try{replay=replayChallenge(JSON.parse(row.party_json),row.seed,body.actions,row.opponents_json?JSON.parse(row.opponents_json):null,row.rules_version);}catch(_){fail(400,'INVALID_KASAI_TRANSCRIPT','バトルの操作記録を再現できませんでした。');}
  if(!replay.ok||!['won','lost'].includes(replay.result))fail(400,'INVALID_KASAI_TRANSCRIPT','操作記録から終了したバトルを確認できませんでした。');
  if(replay.won&&storageCount>=192)fail(409,'KASAI_STORAGE_FULL','ひかえが192体で満員です。空きを作り、期限内に自分で受け取りを再試行してください。');
  const operations=[env.DB.prepare("UPDATE kasai_challenges SET state=?,result_hash=?,completed_at=? WHERE id=? AND player_id=? AND state='pending' AND expires_at>? AND room_owner_id<>player_id AND NOT EXISTS(SELECT 1 FROM admin_members WHERE player_id=?) RETURNING id").bind(replay.won?'won':'lost',resultHash,now,id,player.id,now,player.id)];
  if(replay.won){
    const gender=(crypto.getRandomValues(new Uint8Array(1))[0]&1)?'male':'female';
    operations.push(env.DB.prepare(`INSERT OR IGNORE INTO kasai_rewards (player_id,receipt_id,challenge_id,gender,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM kasai_challenges WHERE id=? AND player_id=? AND state='won' AND result_hash=? AND room_owner_id<>player_id) AND NOT EXISTS(SELECT 1 FROM admin_members WHERE player_id=?)`)
      .bind(player.id,`kasai-reward:${player.id}`,id,gender,now,id,player.id,resultHash,player.id));
  }
  await env.DB.batch(operations);
  await requireKasaiChallenger(env,player,row.room_owner_id);
  const completed=await env.DB.prepare('SELECT state,result_hash FROM kasai_challenges WHERE id=?').bind(id).first();
  if(!completed||completed.state!==(replay.won?'won':'lost')||completed.result_hash!==resultHash)fail(409,'KASAI_CHALLENGE_CHANGED','別の操作で挑戦が終了しました。報酬の受け取り状況を確認してください。');
  return {won:replay.won,result:replay.result,turns:replay.turns,receipt:replay.won?kasaiReceipt(await kasaiReward(env,player.id)):null,serverTime:now};
}
const WORLD_INVITE_SELECT=`SELECT i.*, s.name AS sender_name, t.name AS target_name,
  (SELECT a.singleton FROM admin_members a WHERE a.player_id=i.sender_id) AS sender_admin,
  (SELECT a.singleton FROM admin_members a WHERE a.player_id=i.target_id) AS target_admin,
  sp.avatar AS sender_avatar, tp.avatar AS target_avatar
  FROM world_invitations i JOIN players s ON s.id=i.sender_id JOIN players t ON t.id=i.target_id
  LEFT JOIN world_presence sp ON sp.player_id=i.sender_id LEFT JOIN world_presence tp ON tp.player_id=i.target_id`;
function worldInviteView(row,now=Date.now()) {
  return {id:row.id,requestId:row.request_id,kind:row.kind,roomCode:row.room_code,state:row.state==='pending'&&row.expires_at<=now?'expired':row.state,
    from:worldProfile(row.sender_id,row.sender_name,row.sender_admin,row.sender_avatar),to:worldProfile(row.target_id,row.target_name,row.target_admin,row.target_avatar),
    createdAt:row.created_at,expiresAt:row.expires_at,updatedAt:row.updated_at};
}
async function worldInviteRow(env,id,playerId) {
  const row=UUID.test(id)?await env.DB.prepare(WORLD_INVITE_SELECT+' WHERE i.id=?').bind(id).first():null;
  if(!row)fail(404,'WORLD_INVITATION_NOT_FOUND','このお誘いは見つかりません。');
  if(row.sender_id!==playerId&&row.target_id!==playerId)fail(403,'WORLD_PARTICIPANT_REQUIRED','このお誘いの参加者ではありません。');
  return row;
}
async function worldSnapshot(env,player,map,now) {
  const actors=await env.DB.prepare(`SELECT w.*,p.name,(SELECT a.singleton FROM admin_members a WHERE a.player_id=w.player_id) AS is_admin
    FROM world_presence w JOIN players p ON p.id=w.player_id
    WHERE w.map_id=? AND w.updated_at>? AND w.player_id<>? ORDER BY ABS(w.x-?)+ABS(w.y-?),w.updated_at DESC,w.player_id LIMIT 80`).bind(map.map,now-WORLD_TTL,player.id,map.x,map.y).all();
  const invitations=await env.DB.prepare(WORLD_INVITE_SELECT+" WHERE (i.sender_id=? OR i.target_id=?) AND i.expires_at>? ORDER BY i.updated_at DESC,i.id LIMIT 20").bind(player.id,player.id,now-WORLD_INVITE_RETENTION).all();
  return {self:worldActor({player_id:player.id,name:player.name,is_admin:player.is_admin,map_id:map.map,...map,updated_at:now}),players:actors.results.map(worldActor),invitations:invitations.results.map(row=>worldInviteView(row,now)),serverTime:now,ttlMs:WORLD_TTL,pollAfterMs:500};
}
async function worldNearby(env,senderId,targetId,now) {
  const result=await env.DB.prepare('SELECT * FROM world_presence WHERE player_id IN (?,?) AND updated_at>?').bind(senderId,targetId,now-WORLD_TTL).all();
  const sender=result.results.find(row=>row.player_id===senderId),target=result.results.find(row=>row.player_id===targetId);
  if(!sender||!target)fail(409,'WORLD_PLAYER_OFFLINE','相手がフィールドを離れました。もう一度近くで話しかけてください。');
  if(sender.map_id!==target.map_id||Math.abs(sender.x-target.x)+Math.abs(sender.y-target.y)>WORLD_RADIUS)fail(409,'WORLD_TOO_FAR','同じフィールドで相手の近くに移動してください。');
  return {sender,target};
}
const KASAI_LIVE_TALK_TTL=60000,KASAI_LIVE_HEARTBEAT_TTL=30000;
const KASAI_LIVE_SELECT=`SELECT s.*,c.name AS challenger_name,k.name AS kasai_name,kw.avatar AS kasai_avatar FROM kasai_live_sessions s
  JOIN players c ON c.id=s.challenger_id JOIN players k ON k.id=s.kasai_id LEFT JOIN world_presence kw ON kw.player_id=s.kasai_id`;
const liveSide=(row,playerId)=>row.challenger_id===playerId?0:row.kasai_id===playerId?1:-1;
async function liveRow(env,id){return env.DB.prepare(KASAI_LIVE_SELECT+' WHERE s.id=?').bind(id).first();}
async function activeLiveRow(env,playerId){return env.DB.prepare(KASAI_LIVE_SELECT+" JOIN kasai_live_members m ON m.session_id=s.id WHERE m.player_id=? AND s.state<>'closed'").bind(playerId).first();}
async function closeLiveSession(env,row,reason,now){
  if(!row||row.state==='closed')return row;
  const token=crypto.randomUUID(),positions=[JSON.parse(row.challenger_return_json),JSON.parse(row.kasai_return_json)],ids=[row.challenger_id,row.kasai_id];
  const guard=reason==='talk-timeout'?{sql:"state='staging' AND deadline_at<=?",values:[now]}:
    reason==='disconnected'?{sql:'(challenger_seen<=? OR kasai_seen<=?)',values:[now-KASAI_LIVE_HEARTBEAT_TTL,now-KASAI_LIVE_HEARTBEAT_TTL]}:
    reason==='kasai-changed'?{sql:'NOT EXISTS(SELECT 1 FROM admin_members WHERE player_id=kasai_live_sessions.kasai_id)',values:[]}:
    reason==='declined'?{sql:"state IN ('staging','permission')",values:[]}:
    reason==='battle-error'?{sql:"state='battle' AND round=? AND revision=?",values:[row.round,row.revision]}:{sql:'1',values:[]};
  await env.DB.batch([
    env.DB.prepare(`UPDATE kasai_live_sessions SET state='closed',reason=?,closed_at=?,close_token=?,updated_at=?,revision=revision+1 WHERE id=? AND state<>'closed' AND ${guard.sql}`).bind(reason,now,token,now,row.id,...guard.values),
    ...ids.map((id,side)=>env.DB.prepare(`UPDATE world_presence SET map_id=?,x=?,y=?,facing=?,status='idle' WHERE player_id=?
      AND EXISTS(SELECT 1 FROM kasai_live_sessions WHERE id=? AND close_token=?)`).bind(positions[side].map,positions[side].x,positions[side].y,positions[side].facing,id,row.id,token)),
    env.DB.prepare('DELETE FROM kasai_live_members WHERE session_id=? AND EXISTS(SELECT 1 FROM kasai_live_sessions WHERE id=? AND close_token=?)').bind(row.id,row.id,token)
  ]);
  return liveRow(env,row.id);
}
async function sweepLiveSessions(env,now){
  const active=await env.DB.prepare(KASAI_LIVE_SELECT+" WHERE s.state<>'closed'").all(),members=await env.DB.prepare('SELECT player_id FROM admin_members').all();
  const admins=new Set(members.results.map(member=>member.player_id));
  for(const row of active.results){
    const reason=!admins.has(row.kasai_id)?'kasai-changed':row.state==='staging'&&row.deadline_at<=now?'talk-timeout':
      row.challenger_seen<=now-KASAI_LIVE_HEARTBEAT_TTL||row.kasai_seen<=now-KASAI_LIVE_HEARTBEAT_TTL?'disconnected':null;
    if(reason)await closeLiveSession(env,row,reason,now);
  }
}
async function liveView(env,row,playerId,now){
  if(!row)return null;
  const side=liveSide(row,playerId);if(side<0)fail(403,'KASAI_LIVE_PARTICIPANT_REQUIRED','この対戦の参加者ではありません。');
  const battle=row.battle_json?JSON.parse(row.battle_json):null,orders=await env.DB.prepare('SELECT side FROM kasai_live_orders WHERE session_id=? AND round=?').bind(row.id,row.round).all();
  const reward=await kasaiReward(env,row.challenger_id),currentAdmin=await adminRecord(env,playerId);
  const challengerAdmin=side===0?currentAdmin:await adminRecord(env,row.challenger_id),hostAdmin=side===1?currentAdmin:await adminRecord(env,row.kasai_id);
  return {id:row.id,role:side===0?'challenger':'kasai',state:row.state,roomId:row.room_id,
    challenger:worldProfile(row.challenger_id,row.challenger_name,challengerAdmin?.singleton,row.challenger_avatar),kasai:worldProfile(row.kasai_id,row.kasai_name,hostAdmin?.singleton,row.kasai_avatar),
    deadlineAt:row.deadline_at,reason:row.reason,returnPosition:JSON.parse(side===0?row.challenger_return_json:row.kasai_return_json),
    stagePosition:side===0?{map:'room:'+row.room_id,x:12,y:16,facing:'up'}:{map:'room:'+row.room_id,x:12,y:4,facing:'down'},
    arrived:[!!row.challenger_arrived,!!row.kasai_arrived],battle,round:row.round,submitted:[0,1].map(index=>orders.results.some(order=>order.side===index)),
    rewardEligible:side===0&&['result','closed'].includes(row.state)&&battle?.winner===0&&!currentAdmin,
    rewardClaimed:!!reward,rewardDelivered:reward?.acked_at!=null,revision:row.revision,serverTime:now};
}
async function heartbeatLive(env,row,playerId,now){
  if(!row||row.state==='closed')return row;
  const side=liveSide(row,playerId),column=side===0?'challenger_seen':'kasai_seen';
  await env.DB.batch([
    env.DB.prepare(`UPDATE kasai_live_sessions SET ${column}=? WHERE id=? AND state<>'closed'`).bind(now,row.id),
    env.DB.prepare(`UPDATE world_presence SET updated_at=?,status='busy',map_id=?,x=CASE WHEN ?=1 OR map_id<>? THEN 12 ELSE x END,
      y=CASE WHEN ?=1 THEN 4 WHEN map_id<>? THEN 16 ELSE y END,facing=CASE WHEN ?=1 THEN 'down' WHEN map_id<>? THEN 'up' ELSE facing END
      WHERE player_id=? AND EXISTS(SELECT 1 FROM kasai_live_members WHERE session_id=? AND player_id=?)`)
      .bind(now,'room:'+row.room_id,side,'room:'+row.room_id,side,'room:'+row.room_id,side,'room:'+row.room_id,playerId,row.id,playerId)
  ]);
  return liveRow(env,row.id);
}
async function requireNoLiveSession(env,playerId,now){
  await sweepLiveSessions(env,now);
  if(await activeLiveRow(env,playerId))fail(409,'KASAI_LIVE_BUSY','カサイの対戦が終わり、挑戦者が部屋を出るまでこの操作はできません。');
}
async function resolveLiveSession(env,id,now){
  let row=await liveRow(env,id);if(!row||row.state!=='battle')return row;
  const state=JSON.parse(row.battle_json);let submitted=(await env.DB.prepare('SELECT side,orders_json FROM kasai_live_orders WHERE session_id=? AND round=?').bind(id,row.round).all()).results;
  if(submitted.length===1){
    const other=1-submitted[0].side;
    if(validateLiveOrders(state,other,[]).ok){
      await env.DB.prepare(`INSERT OR IGNORE INTO kasai_live_orders (session_id,side,round,request_id,orders_json,created_at)
        SELECT ?,?,?,?,'[]',? WHERE EXISTS(SELECT 1 FROM kasai_live_sessions WHERE id=? AND state='battle' AND round=?)`)
        .bind(id,other,row.round,crypto.randomUUID(),now,id,row.round).run();
      submitted=(await env.DB.prepare('SELECT side,orders_json FROM kasai_live_orders WHERE session_id=? AND round=?').bind(id,row.round).all()).results;
    }
  }
  if(submitted.length!==2)return row;
  let next;
  try{next=resolveLiveRound(state,[0,1].map(side=>JSON.parse(submitted.find(order=>order.side===side).orders_json)));}
  catch(_){await closeLiveSession(env,row,'battle-error',now);fail(409,'KASAI_LIVE_BATTLE_FAILED','対戦の状態を確認できなかったため、元のフィールドへ戻ります。');}
  if(!next||!Number.isSafeInteger(next.round)||next.round<=row.round||![null,0,1,'draw'].includes(next.winner)){
    await closeLiveSession(env,row,'battle-error',now);fail(409,'KASAI_LIVE_BATTLE_FAILED','対戦の状態を確認できなかったため、元のフィールドへ戻ります。');
  }
  await env.DB.prepare(`UPDATE kasai_live_sessions SET battle_json=?,round=?,state=?,updated_at=?,revision=revision+1
    WHERE id=? AND state='battle' AND round=? AND revision=? AND EXISTS(SELECT 1 FROM admin_members WHERE player_id=kasai_live_sessions.kasai_id)`)
    .bind(JSON.stringify(next),next.round,next.winner===null?'battle':'result',now,id,row.round,row.revision).run();
  return liveRow(env,id);
}
async function kasaiLiveRoute(request,env,path,method,player){
  const now=Date.now();await sweepLiveSessions(env,now);
  if(path==='/api/world/kasai/live'&&method==='GET'){
    let row=await activeLiveRow(env,player.id);
    if(!row){
      row=await env.DB.prepare(KASAI_LIVE_SELECT+' WHERE s.challenger_id=? OR s.kasai_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 1').bind(player.id,player.id).first();
      if(row?.state==='closed'&&(liveSide(row,player.id)===0?row.challenger_ack_at:row.kasai_ack_at)!==null)row=null;
    }
    if(row&&row.state!=='closed'){row=await heartbeatLive(env,row,player.id,now);row=await resolveLiveSession(env,row.id,now);}
    return {session:await liveView(env,row,player.id,now),serverTime:now};
  }
  if(path==='/api/world/kasai/live'&&method==='POST'){
    await requireKasaiChallenger(env,player);
    const body=await bodyJSON(request);kasaiStorage(body.storageCount);
    if(Object.keys(body).some(key=>!['requestId','party','storageCount','roomId'].includes(key))||typeof body.requestId!=='string'||!UUID.test(body.requestId)||body.roomId!==undefined&&(typeof body.roomId!=='string'||!WORLD_PLAYER_ID.test(body.roomId)))fail(400,'INVALID_KASAI_LIVE_REQUEST','カサイへの対戦のお誘いを確認してください。');
    let party;try{party=normalizeKasaiParty(body.party);}catch(_){fail(400,'INVALID_KASAI_PARTY','対戦する手持ちは1〜6体です。');}
    await kasaiOwnedParty(env,party,player);
    const requestId=body.requestId.toLowerCase(),partyJSON=JSON.stringify(party),prior=await env.DB.prepare(KASAI_LIVE_SELECT+' WHERE s.challenger_id=? AND s.request_id=?').bind(player.id,requestId).first();
    if(prior){
      if(prior.challenger_party_json!==partyJSON||body.roomId&&body.roomId!==prior.room_id)fail(409,'KASAI_LIVE_REQUEST_REUSED','同じ対戦の識別情報で別のお誘いは送れません。');
      return {session:await liveView(env,prior,player.id,now),serverTime:now};
    }
    const owner=body.roomId?await adminRecord(env,body.roomId):await ownerRecord(env);
    if(!owner)fail(409,body.roomId?'KASAI_ROOM_UNAVAILABLE':'KASAI_LIVE_OFFLINE','現在のカサイに話しかけてください。');
    if(owner.player_id===player.id)fail(403,'KASAI_SELF_BATTLE','運営のカサイは自分自身とバトルできません。');
    if(body.roomId&&body.roomId!==owner.player_id)fail(409,'KASAI_ROOM_UNAVAILABLE','現在のカサイに話しかけてください。');
    if(await activeLiveRow(env,player.id)||await activeLiveRow(env,owner.player_id))fail(409,'KASAI_LIVE_BUSY','カサイは現在ほかの挑戦者と過ごしています。');
    if(await hasRankedMembership(env,player.id)||await hasRankedMembership(env,owner.player_id))fail(409,'RANKED_BUSY','ランク対戦が終わるまで運営との対戦には参加できません。');
    let positions;try{positions=await worldNearby(env,player.id,owner.player_id,now);}catch(error){if(error instanceof ApiError)fail(409,error.code==='WORLD_PLAYER_OFFLINE'?'KASAI_LIVE_OFFLINE':'KASAI_LIVE_NOT_NEARBY','同じフィールドで、実際のカサイの近くから話しかけてください。');throw error;}
    if(!Object.hasOwn(WORLD_MAP_BOUNDS,positions.sender.map_id))fail(409,'KASAI_LIVE_NOT_NEARBY','外のフィールドでカサイに話しかけてください。');
    if(positions.sender.status!=='idle'||positions.target.status!=='idle')fail(409,'KASAI_LIVE_BUSY','どちらかが別の操作中です。冒険に戻ってから話しかけてください。');
    const room=await currentKasaiRoom(env,owner.player_id);if(!room)fail(409,'KASAI_ROOM_UNAVAILABLE','カサイの部屋はまだ作られていません。運営が壁を向いてAで部屋を作成してから、もう一度誘ってください。');
    await consumeLimit(env,request,`world-kasai-live-start:${player.id}`,12,60000,true);
    const id=crypto.randomUUID(),seed=crypto.getRandomValues(new Uint32Array(1))[0],returns=[positions.sender,positions.target].map(p=>JSON.stringify({map:p.map_id,x:p.x,y:p.y,facing:p.facing}));
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO kasai_live_sessions (id,request_id,challenger_id,kasai_id,room_id,challenger_return_json,kasai_return_json,challenger_party_json,challenger_avatar,challenger_seen,kasai_seen,deadline_at,seed,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM admin_members WHERE player_id=?)
        AND NOT EXISTS(SELECT 1 FROM admin_members WHERE player_id=?)
        AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id IN (?,?))
        AND NOT EXISTS(SELECT 1 FROM ranked_members WHERE player_id IN (?,?))
        AND EXISTS(SELECT 1 FROM world_presence c JOIN world_presence k ON k.player_id=? WHERE c.player_id=? AND c.map_id=k.map_id AND c.map_id=? AND c.updated_at>? AND k.updated_at>? AND c.status='idle' AND k.status='idle' AND ABS(c.x-k.x)+ABS(c.y-k.y)<=?)`)
        .bind(id,requestId,player.id,owner.player_id,room.owner_id,returns[0],returns[1],partyJSON,positions.sender.avatar,now,now,now+KASAI_LIVE_TALK_TTL,seed,now,now,owner.player_id,player.id,player.id,owner.player_id,player.id,owner.player_id,owner.player_id,player.id,positions.sender.map_id,now-WORLD_TTL,now-WORLD_TTL,WORLD_RADIUS),
      ...[player.id,owner.player_id].map((member,side)=>env.DB.prepare('INSERT INTO kasai_live_members (player_id,session_id,side) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM kasai_live_sessions WHERE id=?)').bind(member,id,side,id)),
      ...[player.id,owner.player_id].map((member,side)=>env.DB.prepare(`UPDATE world_presence SET map_id=?,x=12,y=?,facing=?,status='busy' WHERE player_id=? AND EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id=? AND session_id=?)`)
        .bind('room:'+room.owner_id,side===0?16:4,side===0?'up':'down',member,member,id))
    ]);
    const created=await env.DB.prepare(KASAI_LIVE_SELECT+' WHERE s.challenger_id=? AND s.request_id=?').bind(player.id,requestId).first();
    if(!created&&(await hasRankedMembership(env,player.id)||await hasRankedMembership(env,owner.player_id)))fail(409,'RANKED_BUSY','ランク対戦が終わるまで運営との対戦には参加できません。');
    if(!created)fail(409,'KASAI_LIVE_BUSY','カサイの状態が変わりました。近くでもう一度話しかけてください。');
    return {session:await liveView(env,created,player.id,now),serverTime:now};
  }
  const match=/^\/api\/world\/kasai\/live\/([0-9a-f-]+)(?:\/(arrive|talk|answer|actions|leave|ack|claim))?$/.exec(path);
  if(!match||!UUID.test(match[1]))fail(404,'KASAI_LIVE_NOT_FOUND','このカサイとの対戦は見つかりません。');
  let row=await liveRow(env,match[1]);if(!row)fail(404,'KASAI_LIVE_NOT_FOUND','このカサイとの対戦は見つかりません。');
  const side=liveSide(row,player.id);if(side<0)fail(403,'KASAI_LIVE_PARTICIPANT_REQUIRED','この対戦の参加者ではありません。');
  if(!match[2]&&method==='GET'){
    if(row.state!=='closed'){row=await heartbeatLive(env,row,player.id,now);row=await resolveLiveSession(env,row.id,now);}
    return {session:await liveView(env,row,player.id,now),serverTime:now};
  }
  if(method!=='POST'||!match[2])fail(405,'METHOD_NOT_ALLOWED','この対戦の操作方法には対応していません。');
  const body=await bodyJSON(request),operation=match[2],allowed={arrive:['party'],talk:[],answer:['accept'],actions:['round','orders','requestId'],leave:[],ack:[],claim:['storageCount']}[operation];
  if(Object.keys(body).some(key=>!allowed.includes(key)))fail(400,'INVALID_KASAI_LIVE_REQUEST','対戦の操作内容を確認してください。');
  const reply=async()=>({session:await liveView(env,await liveRow(env,row.id),player.id,now),serverTime:now});
  if(operation==='ack'){
    if(row.state!=='closed')fail(409,'KASAI_LIVE_NOT_CLOSED','挑戦者が退出するまで、対戦の部屋に留まります。');
    const col=side===0?'challenger_ack_at':'kasai_ack_at';await env.DB.prepare(`UPDATE kasai_live_sessions SET ${col}=COALESCE(${col},?) WHERE id=? AND state='closed'`).bind(now,row.id).run();
    return {session:null,acknowledged:true,serverTime:now};
  }
  if(operation==='leave'){
    if(row.state!=='closed'&&side!==0)fail(403,'KASAI_LIVE_PINNED','挑戦者が退出するまでカサイは向かいの席で待ちます。');
    row=await closeLiveSession(env,row,'challenger-left',now);return reply();
  }
  if(operation==='claim'){
    await requireKasaiChallenger(env,player,row.kasai_id);
    if(side!==0||!['result','closed'].includes(row.state)||!row.battle_json||JSON.parse(row.battle_json).winner!==0)fail(409,'KASAI_LIVE_NOT_WON','カサイ本人との対戦に勝利した挑戦者だけが受け取れます。');
    if(kasaiStorage(body.storageCount)>=192)fail(409,'KASAI_STORAGE_FULL','ひかえが192体で満員です。空きを作ってから受け取ってください。');
    const existing=await kasaiReward(env,player.id);if(existing){await requireKasaiChallenger(env,player,existing.challenge_room_owner_id);return {...await reply(),receipt:kasaiReceipt(existing)};}
    const gender=(crypto.getRandomValues(new Uint8Array(1))[0]&1)?'male':'female';
    await env.DB.prepare(`INSERT OR IGNORE INTO kasai_rewards (player_id,receipt_id,live_session_id,gender,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM kasai_live_sessions WHERE id=? AND challenger_id=? AND kasai_id<>challenger_id AND state IN ('result','closed') AND json_extract(battle_json,'$.winner')=0)
      AND NOT EXISTS(SELECT 1 FROM admin_members WHERE player_id=?)`).bind(player.id,'kasai-reward:'+player.id,row.id,gender,now,row.id,player.id,player.id).run();
    await requireKasaiChallenger(env,player,row.kasai_id);
    return {...await reply(),receipt:kasaiReceipt(await kasaiReward(env,player.id))};
  }
  if(row.state==='closed')return reply();
  await heartbeatLive(env,row,player.id,now);
  if(operation==='arrive'){
    const flag=side===0?'challenger_arrived':'kasai_arrived',column=side===0?'challenger_party_json':'kasai_party_json';
    let partyJSON=row[column];
    if(side===1&&body.party===undefined&&!row.kasai_arrived)fail(400,'KASAI_LIVE_PARTY_REQUIRED','カサイ本人の現在の手持ちを送ってください。');
    if(body.party!==undefined){let party;try{party=normalizeKasaiParty(body.party);}catch(_){fail(400,'INVALID_KASAI_PARTY','対戦する手持ちは1〜6体です。');}await kasaiOwnedParty(env,party,player);partyJSON=JSON.stringify(party);}
    if(row[flag]){if(partyJSON!==row[column])fail(409,'KASAI_PARTY_CHANGED','入場時の手持ちは対戦が終わるまで変更できません。');return reply();}
    if(row.state!=='staging')fail(409,'KASAI_LIVE_PHASE_CHANGED','対戦の準備状況が変わりました。');
    await env.DB.prepare(`UPDATE kasai_live_sessions SET ${flag}=1,${column}=?,updated_at=?,revision=revision+1 WHERE id=? AND state='staging' AND ${flag}=0 AND EXISTS(SELECT 1 FROM admin_members WHERE player_id=kasai_live_sessions.kasai_id)`)
      .bind(partyJSON,now,row.id).run();return reply();
  }
  if(operation==='talk'){
    if(side!==0)fail(403,'KASAI_LIVE_CHALLENGER_REQUIRED','挑戦者がカサイに話しかけてください。');
    if(['permission','battle','result'].includes(row.state))return reply();
    if(row.state!=='staging'||!row.challenger_arrived||!row.kasai_arrived)fail(409,'KASAI_LIVE_NOT_READY','二人が部屋に入るまでお待ちください。');
    const presence=await env.DB.prepare('SELECT map_id,x,y FROM world_presence WHERE player_id=?').bind(player.id).first();
    if(presence?.map_id!=='room:'+row.room_id||Math.abs(presence.x-12)+Math.abs(presence.y-4)>3)fail(409,'KASAI_NOT_NEARBY','向かいのカサイの近くに行って話しかけてください。');
    await env.DB.prepare("UPDATE kasai_live_sessions SET state='permission',updated_at=?,revision=revision+1 WHERE id=? AND state='staging' AND deadline_at>? AND challenger_arrived=1 AND kasai_arrived=1 AND EXISTS(SELECT 1 FROM admin_members WHERE player_id=kasai_live_sessions.kasai_id)").bind(now,row.id,now).run();return reply();
  }
  if(operation==='answer'){
    if(side!==1)fail(403,'ADMIN_REQUIRED','カサイ本人が対戦の許可を選んでください。');
    if(typeof body.accept!=='boolean')fail(400,'INVALID_KASAI_LIVE_REQUEST','対戦するかどうかを選んでください。');
    if(!body.accept){if(['staging','permission'].includes(row.state))await closeLiveSession(env,row,'declined',now);return reply();}
    if(['battle','result'].includes(row.state))return reply();
    if(row.state!=='permission'||!row.challenger_arrived||!row.kasai_arrived||!row.kasai_party_json)fail(409,'KASAI_LIVE_NOT_READY','挑戦者が話しかけてから対戦を許可してください。');
    const registration=await requireAdmin(env,player);
    const battle=createLiveBattle(JSON.parse(row.challenger_party_json),JSON.parse(row.kasai_party_json),row.seed,[row.challenger_name,worldProfile(player.id,player.name,registration.singleton,'male').name]);
    await env.DB.prepare(`UPDATE kasai_live_sessions SET state='battle',battle_json=?,round=?,updated_at=?,revision=revision+1
      WHERE id=? AND state='permission' AND revision=? AND EXISTS(SELECT 1 FROM admin_members WHERE player_id=kasai_live_sessions.kasai_id AND claimed_at=?)`)
      .bind(JSON.stringify(battle),battle.round,now,row.id,row.revision,registration.claimed_at).run();return reply();
  }
  if(operation==='actions'){
    if(!integer(body.round,1,1000)||typeof body.requestId!=='string'||!UUID.test(body.requestId)||!Array.isArray(body.orders))fail(400,'INVALID_KASAI_LIVE_ORDERS','対戦の行動情報を確認してください。');
    const requestId=body.requestId.toLowerCase(),ordersJSON=JSON.stringify(body.orders),prior=await env.DB.prepare('SELECT round,orders_json FROM kasai_live_orders WHERE session_id=? AND side=? AND request_id=?').bind(row.id,side,requestId).first();
    if(prior){if(prior.round!==body.round||prior.orders_json!==ordersJSON)fail(409,'KASAI_LIVE_REQUEST_REUSED','確定済みの行動と内容が一致しません。');await resolveLiveSession(env,row.id,now);return reply();}
    if(row.state!=='battle'||body.round!==row.round)fail(409,'KASAI_LIVE_ROUND_CHANGED','ターンが進みました。最新の対戦状態を確認してください。');
    const valid=validateLiveOrders(JSON.parse(row.battle_json),side,body.orders);if(!valid.ok)fail(400,'INVALID_KASAI_LIVE_ORDERS',valid.error||'この行動は選べません。');
    await env.DB.prepare(`INSERT OR IGNORE INTO kasai_live_orders (session_id,side,round,request_id,orders_json,created_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM kasai_live_sessions WHERE id=? AND state='battle' AND round=? AND EXISTS(SELECT 1 FROM admin_members WHERE player_id=kasai_live_sessions.kasai_id))`)
      .bind(row.id,side,body.round,requestId,ordersJSON,now,row.id,body.round).run();
    const stored=await env.DB.prepare('SELECT request_id,orders_json FROM kasai_live_orders WHERE session_id=? AND side=? AND round=?').bind(row.id,side,body.round).first();
    if(!stored||stored.request_id!==requestId||stored.orders_json!==ordersJSON)fail(409,'KASAI_LIVE_ALREADY_SUBMITTED','このターンの行動は既に確定しています。');
    await resolveLiveSession(env,row.id,now);return reply();
  }
  fail(404,'KASAI_LIVE_NOT_FOUND','この対戦の操作はありません。');
}

async function worldPopulation(env,now) {
  // Aggregate before projecting: nearby rendering has an 80-actor cap, but
  // stage totals count every actual, fresh player exactly once (including self).
  // The persisted room join excludes deleted/invalid dynamic maps without
  // creating rooms or refreshing presence as a side effect of this read.
  const result=await env.DB.prepare(`SELECT w.map_id AS map,COUNT(*) AS count,r.name AS room_name,r.owner_id AS room_owner,
    (SELECT a.singleton FROM admin_members a WHERE a.player_id=r.owner_id) AS room_admin
    FROM world_presence w JOIN players p ON p.id=w.player_id
    LEFT JOIN world_rooms r ON w.map_id='room:'||r.owner_id
    LEFT JOIN players owner ON owner.id=r.owner_id
    WHERE w.updated_at>? AND (w.map_id IN (SELECT value FROM json_each(?)) OR owner.id IS NOT NULL)
    GROUP BY w.map_id,r.name,r.owner_id ORDER BY w.map_id`)
    .bind(now-WORLD_TTL,JSON.stringify(Object.keys(WORLD_MAP_BOUNDS))).all();
  const rows=result.results.map(row=>({map:row.map,count:row.count,...(row.room_owner?{name:effectiveRoomName(row.room_name,row.room_admin),kind:row.room_admin?'kasai':'secret'}:{})}));
  return {rows,total:rows.reduce((sum,row)=>sum+row.count,0),serverTime:now,ttlMs:WORLD_TTL};
}
const WORLD_CHAT_LIMIT=100,WORLD_CHAT_MAX_LENGTH=300;
const WORLD_CHAT_CLIENT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORLD_CHAT_SELECT=`SELECT m.*,p.name AS author_name,
  (m.player_id=? OR EXISTS(SELECT 1 FROM admin_members a WHERE a.player_id=?)) AS may_delete
  FROM world_chat_messages m JOIN players p ON p.id=m.player_id`;
function worldChatText(value) {
  if(typeof value!=='string')fail(400,'INVALID_CHAT_MESSAGE','メッセージを入力してください。');
  const normalized=value.replace(/\r\n/g,'\n');
  if(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(normalized))fail(400,'INVALID_CHAT_MESSAGE','メッセージに使用できない制御文字が含まれています。');
  const text=normalized.trim(),characters=Array.from(text);
  if(!text.replace(/[\s\u200b-\u200f\u2060-\u206f\ufeff]/gu,'')||characters.length>WORLD_CHAT_MAX_LENGTH||characters.some(char=>char.length===1&&char.charCodeAt(0)>=0xd800&&char.charCodeAt(0)<=0xdfff))fail(400,'INVALID_CHAT_MESSAGE','メッセージは1〜300文字で入力してください。');
  return text;
}
function worldChatMessage(row) {
  return {id:row.id,clientId:row.client_id,authorId:row.player_id,name:row.author_name,
    text:row.deleted_at===null?row.body:null,createdAt:row.created_at,deletedAt:row.deleted_at,
    canDelete:row.deleted_at===null&&!!row.may_delete};
}
async function worldChatRow(env,viewerId,condition,values) {
  return env.DB.prepare(WORLD_CHAT_SELECT+' WHERE '+condition).bind(viewerId,viewerId,...values).first();
}
async function worldChatLatestId(env) {
  return (await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS latest_id FROM world_chat_messages').first()).latest_id;
}
async function worldChatRoute(request,env,path,method,player,now) {
  const url=new URL(request.url);
  if(path==='/api/world/chat'&&method==='GET'){
    const keys=[...url.searchParams.keys()],summary=url.searchParams.get('summary'),after=url.searchParams.get('after')??'0';
    if(new Set(keys).size!==keys.length||keys.some(key=>!['summary','after'].includes(key))||summary!==null&&summary!=='1'||summary===null&&keys.includes('after')||!/^(?:0|[1-9]\d*)$/.test(after)||!integer(Number(after),0,Number.MAX_SAFE_INTEGER))fail(400,'INVALID_CHAT_QUERY','チャットの読み込み指定が正しくありません。');
    if(summary==='1'){
      const row=await env.DB.prepare(`SELECT (SELECT COALESCE(MAX(id),0) FROM world_chat_messages) AS latest_id,
        (SELECT COUNT(*) FROM world_chat_messages WHERE id>? AND deleted_at IS NULL AND player_id<>?) AS unread_count`).bind(Number(after),player.id).first();
      return {latestId:row.latest_id,unreadCount:row.unread_count,serverTime:now};
    }
    const rows=await env.DB.prepare(WORLD_CHAT_SELECT+' ORDER BY m.id DESC LIMIT ?').bind(player.id,player.id,WORLD_CHAT_LIMIT).all();
    const messages=rows.results.reverse().map(worldChatMessage);
    return {messages,latestId:messages.at(-1)?.id||0,serverTime:now};
  }
  if(url.searchParams.size)fail(400,'INVALID_CHAT_QUERY','チャットの操作指定が正しくありません。');
  if(path==='/api/world/chat'&&method==='POST'){
    const body=await bodyJSON(request);
    if(Object.keys(body).some(key=>!['clientId','text'].includes(key)))fail(400,'INVALID_CHAT_MESSAGE','メッセージの送信形式が正しくありません。');
    if(typeof body.clientId!=='string'||!WORLD_CHAT_CLIENT_ID.test(body.clientId))fail(400,'INVALID_CHAT_CLIENT_ID','送信するメッセージの識別情報を確認してください。');
    const clientId=body.clientId.toLowerCase(),text=worldChatText(body.text);
    const existing=await worldChatRow(env,player.id,'m.player_id=? AND m.client_id=?',[player.id,clientId]);
    if(existing){
      if(existing.body!==text)fail(409,'CHAT_REQUEST_REUSED','同じ送信識別情報で別のメッセージは送信できません。');
      return {message:worldChatMessage(existing),latestId:await worldChatLatestId(env),duplicate:true,serverTime:now};
    }
    // A single conditional insert enforces sliding windows across Worker
    // isolates. Deleted messages still count; idempotent retries do not.
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO world_chat_messages (player_id,client_id,body,created_at)
      SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM world_chat_messages WHERE player_id=? AND created_at>?)
      AND (SELECT COUNT(*) FROM world_chat_messages WHERE player_id=? AND created_at>?)<10 RETURNING id`)
      .bind(player.id,clientId,text,now,player.id,now-2000,player.id,now-60000).first();
    const saved=await worldChatRow(env,player.id,'m.player_id=? AND m.client_id=?',[player.id,clientId]);
    if(!saved)fail(429,'CHAT_RATE_LIMITED','投稿は2秒に1回、1分に10回までです。少し待ってから送信してください。');
    if(saved.body!==text)fail(409,'CHAT_REQUEST_REUSED','同じ送信識別情報で別のメッセージは送信できません。');
    return {message:worldChatMessage(saved),latestId:await worldChatLatestId(env),duplicate:!inserted,serverTime:now};
  }
  if(path==='/api/world/chat')fail(405,'METHOD_NOT_ALLOWED','このチャットの操作方法には対応していません。');
  const match=/^\/api\/world\/chat\/([1-9]\d*)$/.exec(path),id=match?Number(match[1]):0;
  if(!match||!integer(id,1,Number.MAX_SAFE_INTEGER))fail(404,'CHAT_MESSAGE_NOT_FOUND','このメッセージは見つかりません。');
  if(method!=='DELETE')fail(405,'METHOD_NOT_ALLOWED','このチャットの操作方法には対応していません。');
  if(request.body&&Object.keys(await bodyJSON(request)).length)fail(400,'INVALID_CHAT_MESSAGE','削除するメッセージの指定を確認してください。');
  let row=await worldChatRow(env,player.id,'m.id=?',[id]);
  if(!row)fail(404,'CHAT_MESSAGE_NOT_FOUND','このメッセージは見つかりません。');
  if(!row.may_delete)fail(403,'CHAT_DELETE_FORBIDDEN','自分の投稿だけを削除できます。');
  if(row.deleted_at===null){
    await env.DB.prepare(`UPDATE world_chat_messages SET deleted_at=?,deleted_by=? WHERE id=? AND deleted_at IS NULL
      AND (player_id=? OR EXISTS(SELECT 1 FROM admin_members a WHERE a.player_id=?))`).bind(now,player.id,id,player.id,player.id).run();
    row=await worldChatRow(env,player.id,'m.id=?',[id]);
    if(!row?.may_delete)fail(403,'CHAT_DELETE_FORBIDDEN','このメッセージを削除する権限がありません。');
    if(row.deleted_at===null)fail(409,'CHAT_MESSAGE_CHANGED','操作中に権限が変わりました。メッセージを読み込み直してください。');
  }
  return {message:worldChatMessage(row),latestId:await worldChatLatestId(env),serverTime:now};
}
async function worldRoute(request,env,path,method,player) {
  const now=Date.now();
  if(path==='/api/world/ranked'||path.startsWith('/api/world/ranked/'))return rankedRoute(request,env,path,method,player,{fail,bodyJSON,consumeLimit,activeTrade,validateOwned:kasaiOwnedParty,refreshLive:sweepLiveSessions});
  if(path==='/api/world/chat'||path.startsWith('/api/world/chat/'))return worldChatRoute(request,env,path,method,player,now);
  if(path==='/api/world/population'&&method==='GET')return worldPopulation(env,now);
  if(path==='/api/world/rooms'||path.startsWith('/api/world/rooms/'))return roomsRoute(request,env,path,method,player);
  if(path==='/api/world/kasai'||path.startsWith('/api/world/kasai/'))return kasaiRoute(request,env,path,method,player);
  if((path==='/api/world/trainer-pass'||path==='/api/world/trainer-pass/verify')&&method==='POST') {
    if(typeof env.DUEL_SIGNING_KEY!=='string'||env.DUEL_SIGNING_KEY.length<32)fail(503,'TRAINER_NOT_CONFIGURED','トレーナーの認証を準備中です。通常の対戦は続けられます。');
    const body=await bodyJSON(request),battleSession=sessionId(body.sessionId),side=sideId(body.side),verify=path.endsWith('/verify');
    if(Object.keys(body).some(key=>!['sessionId','side',...(verify?['pass']:[])].includes(key)))fail(400,'INVALID_TRAINER_PASS','トレーナーの認証情報を確認してください。');
    await consumeLimit(env,request,`world-trainer-pass:${player.id}`,60,60000,true);
    const key=await signingKey(env);
    if(!verify) {
      const presence=await env.DB.prepare('SELECT avatar FROM world_presence WHERE player_id=?').bind(player.id).first();
      const profile=worldProfile(player.id,player.name,player.is_admin,presence?.avatar);
      const data={v:1,kind:'trainer',playerId:player.id,name:profile.name,isAdmin:profile.isAdmin,adminRole:profile.adminRole,avatar:profile.avatar,sessionId:battleSession,side,expiresAt:now+600000};
      const payload=encoder.encode(JSON.stringify(data)),signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,payload));
      return {pass:encodeURL(payload)+'.'+encodeURL(signature)};
    }
    if(typeof body.pass!=='string'||body.pass.length>4096)fail(400,'INVALID_TRAINER_PASS','トレーナーの認証情報が正しくありません。');
    try {
      const parts=body.pass.split('.');if(parts.length!==2)throw new Error('Invalid encoding');
      const payload=decodeURL(parts[0]),signature=decodeURL(parts[1]);
      if(signature.length!==32||!await crypto.subtle.verify('HMAC',key,signature,payload))throw new Error('Invalid signature');
      const data=JSON.parse(new TextDecoder().decode(payload));
      if(data.v!==1||data.kind!=='trainer'||typeof data.playerId!=='string'||!WORLD_PLAYER_ID.test(data.playerId)||data.sessionId!==battleSession||data.side!==side||!integer(data.expiresAt,now+1,now+600001))throw new Error('Invalid payload');
      // Re-read the current role and name, rather than letting an old signed
      // administrator profile survive an ownership transfer or release.
      const row=await env.DB.prepare(`SELECT p.id,p.name,w.avatar,(SELECT a.singleton FROM admin_members a WHERE a.player_id=p.id) AS is_admin
        FROM players p LEFT JOIN world_presence w ON w.player_id=p.id WHERE p.id=?`).bind(data.playerId).first();
      if(!row)throw new Error('Player missing');
      return {trainer:worldProfile(row.id,row.name,row.is_admin,row.avatar)};
    } catch(error) {
      if(error instanceof ApiError)throw error;
      fail(403,'INVALID_TRAINER_PASS','トレーナーの認証情報が無効、または期限切れです。');
    }
  }
  if(path==='/api/world/presence'&&method==='POST') {
    await sweepLiveSessions(env,now);
    const body=await validateWorldPresence(env,await bodyJSON(request)),live=await activeLiveRow(env,player.id);
    if(live){
      if(liveSide(live,player.id)===1)Object.assign(body,{map:'room:'+live.room_id,x:12,y:4,facing:'down',status:'busy'});
      else if(body.map!=='room:'+live.room_id)fail(409,'KASAI_LIVE_LOCKED','カサイの部屋を出るときは対戦の退出を選んでください。');
      else body.status='busy';
    }
    // A conditional UPSERT caps writes at four per second per player, including
    // concurrent requests, without sharing limits with players behind one NAT.
    const accepted=await env.DB.prepare(`INSERT INTO world_presence (player_id,map_id,x,y,facing,avatar,status,updated_at,input_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE (? IS NULL AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id=?))
        OR EXISTS(SELECT 1 FROM kasai_live_members m JOIN kasai_live_sessions s ON s.id=m.session_id
          WHERE m.player_id=? AND m.session_id=? AND s.state<>'closed' AND EXISTS(SELECT 1 FROM admin_members WHERE player_id=s.kasai_id))
      ON CONFLICT(player_id) DO UPDATE SET map_id=excluded.map_id,x=excluded.x,y=excluded.y,facing=excluded.facing,avatar=excluded.avatar,status=excluded.status,updated_at=excluded.updated_at,input_at=excluded.input_at
      WHERE world_presence.input_at<=? RETURNING player_id`)
      .bind(player.id,body.map,body.x,body.y,body.facing,body.avatar,body.status,now,now,live?.id||null,player.id,player.id,live?.id||null,now-250).first();
    if(!accepted){
      await sweepLiveSessions(env,now);const current=await activeLiveRow(env,player.id);
      if((current?.id||null)!==(live?.id||null))fail(409,'KASAI_LIVE_CHANGED','カサイの対戦への入退室が変わりました。最新のフィールドを確認してください。');
      fail(429,'WORLD_UPDATE_TOO_FAST','少し待ってからフィールドを更新してください。');
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE world_invitations SET state='expired',updated_at=? WHERE (sender_id=? OR target_id=?) AND state='pending' AND (expires_at<=? OR map_id<>?)").bind(now,player.id,player.id,now,body.map),
      env.DB.prepare('DELETE FROM world_presence WHERE player_id IN (SELECT player_id FROM world_presence WHERE updated_at<? LIMIT 32)').bind(now-WORLD_TTL*4),
      // Accepted trade invitations remain until their trade expires, so a
      // suspended tab can still join its reserved room after reconnecting.
      env.DB.prepare("DELETE FROM world_invitations WHERE id IN (SELECT i.id FROM world_invitations i WHERE i.expires_at<? AND NOT(i.kind='trade' AND i.state='accepted' AND EXISTS(SELECT 1 FROM trades t WHERE t.code=i.room_code AND t.state='open' AND t.expires_at>?)) LIMIT 32)").bind(now-WORLD_INVITE_RETENTION,now)
    ]);
    return worldSnapshot(env,player,body,now);
  }
  if(path==='/api/world/presence'&&method==='DELETE') {
    await sweepLiveSessions(env,now);
    const live=await activeLiveRow(env,player.id);
    if(live){if(liveSide(live,player.id)===1)fail(403,'KASAI_LIVE_PINNED','挑戦者が退出するまでカサイは向かいの席で待ちます。');await closeLiveSession(env,live,'challenger-left',now);}
    await env.DB.batch([
      env.DB.prepare('DELETE FROM world_presence WHERE player_id=? AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id=world_presence.player_id)').bind(player.id),
      env.DB.prepare("UPDATE world_invitations SET state='cancelled',updated_at=? WHERE (sender_id=? OR target_id=?) AND state='pending'").bind(now,player.id,player.id)
    ]);
    return {left:true,serverTime:now};
  }
  if(path==='/api/world/invitations'&&method==='POST') {
    const body=await bodyJSON(request),code=typeof body.roomCode==='string'?body.roomCode.trim().toUpperCase():'';
    if(Object.keys(body).some(key=>!WORLD_INVITE_FIELDS.has(key))||typeof body.targetId!=='string'||!WORLD_PLAYER_ID.test(body.targetId)||body.targetId===player.id||!['battle','trade'].includes(body.kind)||!/^[A-HJ-NP-Z2-9]{6}$/.test(code)||body.requestId!==undefined&&(typeof body.requestId!=='string'||!UUID.test(body.requestId)))fail(400,'INVALID_WORLD_INVITATION','お誘いの相手・種類・ルームコードを確認してください。');
    const requestId=(body.requestId||crypto.randomUUID()).toLowerCase();
    const prior=await env.DB.prepare('SELECT id FROM world_invitations WHERE sender_id=? AND request_id=?').bind(player.id,requestId).first();
    if(prior) {
      const row=await worldInviteRow(env,prior.id,player.id);
      if(row.target_id!==body.targetId||row.kind!==body.kind||row.room_code!==code)fail(409,'WORLD_REQUEST_REUSED','同じ作成情報で別のお誘いは送れません。');
      return {invitation:worldInviteView(row),serverTime:now};
    }
    await consumeLimit(env,request,`world-invite:${player.id}`,8,60000,true);
    const {sender,target}=await worldNearby(env,player.id,body.targetId,now);
    if(sender.status!=='idle'||target.status!=='idle')fail(409,'WORLD_PLAYER_BUSY','相手の対戦・交換・会話が終わるまでお待ちください。');
    if(body.kind==='trade') {
      const trade=await env.DB.prepare('SELECT * FROM trades WHERE code=?').bind(code).first();
      if(!trade||trade.host_id!==player.id||trade.state!=='open'||trade.guest_id||trade.expires_at<=now)fail(409,'WORLD_TRADE_UNAVAILABLE','自分で作成した、参加者のいない交換ルームを選んでください。');
      if(await activeTrade(env,body.targetId))fail(409,'WORLD_PLAYER_BUSY','相手は交換中です。交換が終わるまでお待ちください。');
    }
    const id=crypto.randomUUID(),tradeGuard=body.kind==='trade'?" AND EXISTS(SELECT 1 FROM trades tr WHERE tr.code=? AND tr.host_id=s.player_id AND tr.state='open' AND tr.guest_id IS NULL AND tr.expires_at>?) AND NOT EXISTS(SELECT 1 FROM trade_active ta WHERE ta.player_id=t.player_id)":'';
    const create=env.DB.prepare(`INSERT OR IGNORE INTO world_invitations (id,request_id,sender_id,target_id,kind,room_code,map_id,created_at,expires_at,updated_at)
      SELECT ?,?,s.player_id,t.player_id,?,?,s.map_id,?,?,? FROM world_presence s JOIN world_presence t ON t.player_id=?
      WHERE s.player_id=? AND s.status='idle' AND t.status='idle' AND s.updated_at>? AND t.updated_at>?
      AND s.map_id=t.map_id AND ABS(s.x-t.x)+ABS(s.y-t.y)<=?
      AND NOT EXISTS(SELECT 1 FROM world_invitations i WHERE i.state='pending' AND i.expires_at>? AND (i.sender_id IN(s.player_id,t.player_id) OR i.target_id IN(s.player_id,t.player_id)))${tradeGuard}`)
      .bind(id,requestId,body.kind,code,now,now+WORLD_INVITE_TTL,now,body.targetId,player.id,now-WORLD_TTL,now-WORLD_TTL,WORLD_RADIUS,now,...(body.kind==='trade'?[code,now]:[]));
    const statements=[create];
    if(body.kind==='trade')statements.push(env.DB.prepare('UPDATE trades SET world_guest_id=? WHERE code=? AND host_id=? AND EXISTS(SELECT 1 FROM world_invitations WHERE id=?)').bind(body.targetId,code,player.id,id));
    await env.DB.batch(statements);
    const created=await env.DB.prepare('SELECT id FROM world_invitations WHERE sender_id=? AND request_id=?').bind(player.id,requestId).first();
    if(!created)fail(409,'WORLD_INVITATION_BUSY','相手または自分に進行中のお誘いがあります。現在のお誘いを確認してください。');
    return {invitation:worldInviteView(await worldInviteRow(env,created.id,player.id),now),serverTime:now};
  }
  const match=/^\/api\/world\/invitations\/([0-9a-f-]+)(?:\/(respond|cancel))?$/.exec(path);
  if(!match)fail(404,'NOT_FOUND','このフィールド操作はありません。');
  const [,id,operation]=match;
  let row=await worldInviteRow(env,id,player.id);
  if(!operation&&method==='GET')return {invitation:worldInviteView(row,now),serverTime:now};
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','この操作方法には対応していません。');
  const body=await bodyJSON(request);
  if(operation==='respond') {
    if(row.target_id!==player.id)fail(403,'WORLD_RECIPIENT_REQUIRED','お誘いを受けた人だけが返事できます。');
    if(typeof body.accept!=='boolean'||Object.keys(body).some(key=>key!=='accept'))fail(400,'INVALID_WORLD_RESPONSE','参加するか、断るかを選んでください。');
    if(row.state!=='pending'||row.expires_at<=now)return {invitation:worldInviteView(row,now),serverTime:now};
    await consumeLimit(env,request,`world-respond:${player.id}`,30,60000,true);
    if(body.accept) {
      const {sender,target}=await worldNearby(env,row.sender_id,row.target_id,now);
      if(sender.map_id!==row.map_id||target.map_id!==row.map_id)fail(409,'WORLD_TOO_FAR','お誘いを送ったフィールドで、もう一度近くで話しかけてください。');
      if(row.kind==='trade') {
        const room=await env.DB.prepare("SELECT id FROM trades WHERE code=? AND host_id=? AND world_guest_id=? AND state='open' AND guest_id IS NULL AND expires_at>?").bind(row.room_code,row.sender_id,row.target_id,now).first();
        if(!room||await activeTrade(env,row.target_id))fail(409,'WORLD_TRADE_UNAVAILABLE','交換ルームの状態が変わりました。もう一度お誘いを受けてください。');
      }
    }
    // Recheck presence and proximity inside the same atomic update that accepts
    // the invitation, in case a player moved between the reads above.
    const nearGuard=body.accept?` AND EXISTS(SELECT 1 FROM world_presence s JOIN world_presence t ON t.player_id=world_invitations.target_id WHERE s.player_id=world_invitations.sender_id AND s.updated_at>? AND t.updated_at>? AND s.map_id=world_invitations.map_id AND t.map_id=s.map_id AND ABS(s.x-t.x)+ABS(s.y-t.y)<=?)`:'';
    const operations=[env.DB.prepare(`UPDATE world_invitations SET state=?,updated_at=? WHERE id=? AND target_id=? AND state='pending' AND expires_at>?${nearGuard}`).bind(body.accept?'accepted':'declined',now,id,player.id,now,...(body.accept?[now-WORLD_TTL,now-WORLD_TTL,WORLD_RADIUS]:[]))];
    if(body.accept)operations.push(env.DB.prepare("UPDATE world_presence SET status='busy' WHERE player_id IN (?,?) AND EXISTS(SELECT 1 FROM world_invitations WHERE id=? AND state='accepted')").bind(row.sender_id,row.target_id,id));
    await env.DB.batch(operations);
  } else if(operation==='cancel') {
    if(row.sender_id!==player.id)fail(403,'WORLD_SENDER_REQUIRED','お誘いを送った人だけが取り消せます。');
    if(Object.keys(body).length)fail(400,'INVALID_WORLD_RESPONSE','取り消しの形式が正しくありません。');
    await env.DB.prepare("UPDATE world_invitations SET state='cancelled',updated_at=? WHERE id=? AND sender_id=? AND state='pending'").bind(now,id,player.id).run();
  } else fail(404,'NOT_FOUND','このフィールド操作はありません。');
  row=await worldInviteRow(env,id,player.id);
  return {invitation:worldInviteView(row,now),serverTime:now};
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
  if(path==='/api/world'||path.startsWith('/api/world/'))return worldRoute(request,env,path,method,player);
  if(path==='/api/trades'||path.startsWith('/api/trades/'))return tradeRoute(request,env,path,method,player);
  if (path === '/api/me' && method === 'GET') {
    const {cursor, limit} = paging(url);
    return {player:playerView(player), ...await adminState(env, request), ...await playerGrants(env, player.id, cursor, limit), initialCompanions:await initialCompanions(env, player.id), adminReserveTeam:await adminReserveTeam(env,player.id), adminReserveAddition:await adminReserveAddition(env,player.id)};
  }
  if (path === '/api/me' && method === 'PATCH') {
    const name = safeName((await bodyJSON(request)).name);
    await consumeLimit(env, request, `rename:${player.id}`, 30, 60000, true);
    await env.DB.prepare('UPDATE players SET name = ?, updated_at = ? WHERE id = ?').bind(name, Date.now(), player.id).run();
    return {player:playerView({...player,name}), ...await adminState(env, request)};
  }
  if (path === '/api/duel-pass' && method === 'POST') {
    const body = await bodyJSON(request), session = sessionId(body.sessionId), side = sideId(body.side);
    if (typeof body.grantId !== 'string' || body.grantId.length > 100) fail(400, 'INVALID_GRANT', 'フートの受取記録を指定してください。');
    await consumeLimit(env, request, `duel-issue:${player.id}`, 30, 60000, true);
    if(body.grantId.startsWith('kasai-reward:')){
      if(body.grantId!==`kasai-reward:${player.id}`||!await kasaiReward(env,player.id))fail(403,'GRANT_NOT_OWNED','このキラシードの勝利報酬を確認できません。');
      const expiresAt=Date.now()+600000,payload=encoder.encode(JSON.stringify({v:3,species:'floravelle',playerId:player.id,grantId:body.grantId,sessionId:session,side,expiresAt}));
      const signature=new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env),payload));
      return {pass:`${encodeURL(payload)}.${encodeURL(signature)}`,expiresAt};
    }
    if(body.grantId.startsWith('admin-mythical:')){
      if(!await adminRecord(env,player.id)||body.grantId!==`admin-mythical:${player.id}`)fail(403,'GRANT_NOT_OWNED','この幻パチモンは現在の運営だけが使用できます。');
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
    const current = await adminRecord(env, player.id);
    if (current) return {player:playerView({...player, is_admin:current.singleton}), ...await adminState(env, request), ...await playerGrants(env, player.id, 0, 100), initialCompanions:await initialCompanions(env, player.id)};
    const firstOwner = await ownerRecord(env), configuredOwner = await recoveryOwner(env), configured = recoveryAllowed(env, request, configuredOwner);
    const previousOwner = configured ? configuredOwner : firstOwner;
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
    const claimGuard = recovering ? 'EXISTS (SELECT 1 FROM admin_members WHERE singleton = ? AND player_id = ? AND claimed_at = ?)' : 'NOT EXISTS (SELECT 1 FROM admin_members)';
    const claimValues = recovering ? [previousOwner.singleton, previousOwner.player_id, previousOwner.claimed_at] : [];
    const claimOwner = recovering ?
      env.DB.prepare(`UPDATE ${adminTable(previousOwner)} SET player_id = ?, claimed_at = (SELECT claimed_at FROM admin_registration_clock WHERE singleton = 1)
        WHERE singleton = 1 AND player_id = ? AND claimed_at = ? AND NOT EXISTS (SELECT 1 FROM admin_members WHERE player_id = ?)`)
        .bind(player.id, previousOwner.player_id, previousOwner.claimed_at, player.id) :
      env.DB.prepare('INSERT OR IGNORE INTO admin_owner (singleton, player_id, claimed_at) SELECT 1, ?, claimed_at FROM admin_registration_clock WHERE singleton = 1 AND NOT EXISTS (SELECT 1 FROM admin_members)').bind(player.id);
    await env.DB.batch([
      nextAdminRegistration(env, now, claimGuard, claimValues),
      claimOwner,
      env.DB.prepare('INSERT OR IGNORE INTO futo_config (singleton, config_json, revision, updated_at) SELECT 1, ?, 1, ? WHERE EXISTS (SELECT 1 FROM admin_members WHERE player_id = ?)').bind(config, now, player.id),
      env.DB.prepare('INSERT OR IGNORE INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) SELECT ?, ?, ?, ?, config_json, ?, ? FROM futo_config WHERE singleton = 1 AND EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND singleton IN (1,3))').bind(batchId, player.id, player.id, payloadHash, player.row_id, now, player.id),
      env.DB.prepare('INSERT INTO grants (grant_id, batch_id, player_id, config_json, created_at) SELECT ?, ?, ?, config_json, ? FROM futo_config WHERE singleton = 1 AND EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND singleton IN (1,3)) ON CONFLICT(grant_id) DO UPDATE SET config_json = excluded.config_json').bind(`admin-initial:${player.id}`, batchId, player.id, now, player.id)
    ]);
    const claimed = await adminRecord(env, player.id);
    if (!claimed) fail(409, 'ADMIN_ALREADY_EXISTS', '運営はすでに登録されています。');
    return {player:playerView({...player, is_admin:claimed.singleton}), ...await adminState(env, request), ...await playerGrants(env, player.id, 0, 100), initialCompanions:await initialCompanions(env, player.id)};
  }
  const registration = await requireAdmin(env, player);
  if (path === '/api/admin/devices' && method === 'GET') {
    let candidate;
    if (url.searchParams.has('playerId')) {
      const id = adminPlayerId(url.searchParams.get('playerId'));
      const row = await env.DB.prepare('SELECT p.id, p.name, a.singleton, a.claimed_at FROM players p LEFT JOIN admin_members a ON a.player_id = p.id WHERE p.id = ?').bind(id).first();
      if (!row) fail(404, 'PLAYER_NOT_FOUND', 'プレイヤーが見つかりません。');
      candidate = {playerId:row.id, name:row.name, displayName:adminDisplayName(row.name,row.singleton), isAdmin:!!row.singleton, ...(row.singleton ? {role:adminRole(row.singleton), claimedAt:row.claimed_at} : {})};
    }
    const result = await adminDevices(env, player.id);
    await requireAdmin(env, player);
    return {...result, ...(candidate ? {candidate} : {})};
  }
  if (path === '/api/admin/devices' && method === 'POST') {
    requireMainAdmin(registration);
    const body = await bodyJSON(request), id = adminPlayerId(body.playerId);
    if (body.confirmed !== true) fail(400, 'ADMIN_CONFIRMATION_REQUIRED', '追加するプレイヤーを確認してから操作してください。');
    if (body.role !== undefined && !['sub','sub-sub'].includes(body.role)) fail(400, 'INVALID_ADMIN_ROLE', 'サブ運営またはサブサブ運営を選んでください。');
    if (id === player.id) fail(400, 'ADMIN_SELF_TARGET', '自分以外のプレイヤーIDを指定してください。');
    const target = await env.DB.prepare('SELECT id, row_id FROM players WHERE id = ?').bind(id).first();
    if (!target) fail(404, 'PLAYER_NOT_FOUND', 'プレイヤーが見つかりません。');
    const existing = await adminRecord(env, id);
    if (existing) {
      requireMainAdmin(await requireAdmin(env, player));
      if (body.role !== undefined && body.role !== adminRole(existing.singleton)) fail(409, 'ADMIN_ROLE_CHANGED', 'このプレイヤーは別の運営役職で登録されています。最新の一覧を確認してください。');
      return {...await adminDevices(env, player.id), added:false};
    }
    const now = Date.now(), config = JSON.stringify((await configRecord(env)).config), payloadHash = await digest(config), batchId = `admin-initial:${id}`;
    const authority = 'EXISTS (SELECT 1 FROM admin_members WHERE singleton = 1 AND player_id = ? AND claimed_at = ?)';
    const authorityValues = [player.id, registration.claimed_at];
    const seats = body.role === undefined ? [2,3] : [body.role === 'sub' ? 2 : 3];
    const vacancy = '('+seats.map(seat => `NOT EXISTS (SELECT 1 FROM admin_members WHERE singleton = ${seat})`).join(' OR ')+')';
    const granted = `EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND singleton IN (${seats.join(',')}))`;
    const initialGranted = `EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND singleton IN (${seats.filter(seat=>seat!==2).join(',')||'NULL'}))`;
    const results = await env.DB.batch([
      nextAdminRegistration(env, now, `${authority} AND ${vacancy} AND NOT EXISTS (SELECT 1 FROM admin_members WHERE player_id = ?)`, [...authorityValues, id]),
      ...seats.map(seat => env.DB.prepare(`INSERT OR IGNORE INTO ${adminTable({singleton:seat})} (singleton, player_id, claimed_at)
        SELECT 1, ?, claimed_at FROM admin_registration_clock WHERE singleton = 1 AND ${authority}
        AND NOT EXISTS (SELECT 1 FROM admin_members WHERE player_id = ?)`).bind(id, ...authorityValues, id)),
      env.DB.prepare(`INSERT OR IGNORE INTO futo_config (singleton, config_json, revision, updated_at) SELECT 1, ?, 1, ?
        WHERE ${authority} AND ${granted}`).bind(config, now, ...authorityValues, id),
      env.DB.prepare(`INSERT OR IGNORE INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at)
        SELECT ?, ?, ?, ?, config_json, ?, ? FROM futo_config WHERE singleton = 1 AND ${authority}
        AND ${initialGranted}`).bind(batchId, player.id, id, payloadHash, target.row_id, now, ...authorityValues, id),
      env.DB.prepare(`INSERT INTO grants (grant_id, batch_id, player_id, config_json, created_at)
        SELECT ?, ?, ?, config_json, ? FROM futo_config WHERE singleton = 1 AND ${authority} AND ${initialGranted}
        ON CONFLICT(grant_id) DO UPDATE SET config_json = excluded.config_json`).bind(`admin-initial:${id}`, batchId, id, now, ...authorityValues, id)
    ]);
    const current = await requireAdmin(env, player);
    if (current.claimed_at !== registration.claimed_at) fail(403, 'ADMIN_REQUIRED', '運営登録が変更されました。最新の状態で操作してください。');
    const assigned = await adminRecord(env, id);
    if (!assigned) {
      if (body.role !== undefined) fail(409, 'ADMIN_ROLE_OCCUPIED', '選んだ運営役職は登録済みです。最新の一覧を確認してください。');
      fail(409, 'ADMIN_CAPACITY_REACHED', '運営として登録できる端末は3台までです。');
    }
    if (!seats.includes(assigned.singleton)) fail(409, 'ADMIN_ROLE_CHANGED', 'このプレイヤーは別の運営役職で登録されています。最新の一覧を確認してください。');
    return {...await adminDevices(env, player.id), added:results.slice(1, 1 + seats.length).some(result => result.meta?.changes > 0)};
  }
  if (path === '/api/admin/devices/revoke' && method === 'POST') {
    requireMainAdmin(registration);
    const body = await bodyJSON(request), id = adminPlayerId(body.playerId);
    if (body.confirmed !== true || !Number.isSafeInteger(body.claimedAt) || body.claimedAt < 0) fail(400, 'ADMIN_CONFIRMATION_REQUIRED', '解除する運営登録を確認してから操作してください。');
    if (id === player.id) fail(400, 'ADMIN_SELF_TARGET', '自分の登録は「この端末の運営登録を解除」から解除してください。');
    const target = await adminRecord(env, id);
    if (!target || target.claimed_at !== body.claimedAt) fail(409, 'ADMIN_REGISTRATION_CHANGED', '運営登録が変更されています。最新の状態を確認してください。');
    if (target.singleton === 1) fail(403, 'MAIN_ADMIN_PROTECTED', 'メイン運営の登録はサブ運営の解雇では解除できません。');
    const removed = await env.DB.prepare(`DELETE FROM ${adminTable(target)} WHERE singleton = 1 AND player_id = ? AND claimed_at = ?
      AND EXISTS (SELECT 1 FROM admin_members WHERE singleton = 1 AND player_id = ? AND claimed_at = ?) RETURNING player_id`).bind(id, body.claimedAt, player.id, registration.claimed_at).first();
    const current = await requireAdmin(env, player);
    if (current.claimed_at !== registration.claimed_at) fail(403, 'ADMIN_REQUIRED', '運営登録が変更されました。最新の状態で操作してください。');
    if (!removed) fail(409, 'ADMIN_REGISTRATION_CHANGED', '運営登録が変更されています。最新の状態を確認してください。');
    return {...await adminDevices(env, player.id), revoked:true};
  }
  if (path === '/api/admin/config' && method === 'GET') {
    const own = await requireAdmin(env, player);
    return {...await configRecord(env), adminRegistration:{playerId:own.player_id, claimedAt:own.claimed_at}};
  }
  if (path === '/api/admin/release' && method === 'POST') {
    const body = await bodyJSON(request), expected = body.expectedRegistration;
    if (body.confirmed !== true || expected?.playerId !== player.id || !Number.isSafeInteger(expected?.claimedAt) || expected.claimedAt < 0) {
      fail(400, 'RELEASE_CONFIRMATION_REQUIRED', '運営登録の解除内容を確認してから操作してください。');
    }
    // Delete only the exact registration reviewed by the current owner. A
    // delayed request must never release a replacement administrator.
    let removed;
    if (registration.singleton === 1) {
      const successor = await env.DB.prepare('SELECT singleton, player_id, claimed_at FROM admin_members WHERE singleton > 1 ORDER BY singleton LIMIT 1').first(), operationId = crypto.randomUUID();
      const successorGuard = successor ? 'EXISTS (SELECT 1 FROM admin_members WHERE singleton = ? AND player_id = ? AND claimed_at = ?) AND NOT EXISTS (SELECT 1 FROM admin_members WHERE singleton > 1 AND singleton < ?)' : 'NOT EXISTS (SELECT 1 FROM admin_members WHERE singleton > 1)';
      const promotionGifts=[];
      if(successor){
        // A gift-free sub may now become main. Create only a missing initial
        // Futo after this exact promotion succeeds, retaining historical rows.
        const config=JSON.stringify((await configRecord(env)).config),payloadHash=await digest(config),grantId=`admin-initial:${successor.player_id}`,createdAt=Date.now();
        const promoted='EXISTS (SELECT 1 FROM admin_owner a JOIN admin_registration_clock c ON c.claimed_at=a.claimed_at WHERE a.singleton=1 AND a.player_id=? AND c.singleton=1 AND c.operation_id=?)';
        const missing='NOT EXISTS (SELECT 1 FROM grants WHERE grant_id=?)';
        promotionGifts.push(
          env.DB.prepare(`INSERT OR IGNORE INTO grant_batches (id,creator_id,target,payload_hash,config_json,max_player_row,created_at)
            SELECT ?,?,?,?, ?,row_id,? FROM players WHERE id=? AND ${promoted} AND ${missing}`)
            .bind(grantId,player.id,successor.player_id,payloadHash,config,createdAt,successor.player_id,successor.player_id,operationId,grantId),
          env.DB.prepare(`INSERT OR IGNORE INTO grants (grant_id,batch_id,player_id,config_json,created_at)
            SELECT ?,?,?,?,? WHERE ${promoted} AND ${missing}`)
            .bind(grantId,grantId,successor.player_id,config,createdAt,successor.player_id,operationId,grantId)
        );
      }
      const results = await env.DB.batch([
        nextAdminRegistration(env, Date.now(), `EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ? AND claimed_at = ?) AND ${successorGuard}`,
          [player.id, expected.claimedAt, ...(successor ? [successor.singleton, successor.player_id, successor.claimed_at, successor.singleton] : [])], operationId),
        env.DB.prepare('DELETE FROM admin_owner WHERE singleton = 1 AND player_id = ? AND claimed_at = ? AND EXISTS (SELECT 1 FROM admin_registration_clock WHERE operation_id = ?) RETURNING player_id').bind(player.id, expected.claimedAt, operationId),
        ...(successor ? [
          env.DB.prepare(`DELETE FROM ${adminTable(successor)} WHERE singleton = 1 AND player_id = ? AND claimed_at = ? AND EXISTS (SELECT 1 FROM admin_registration_clock WHERE operation_id = ?)`).bind(successor.player_id, successor.claimed_at, operationId),
          env.DB.prepare('INSERT INTO admin_owner (singleton, player_id, claimed_at) SELECT 1, ?, claimed_at FROM admin_registration_clock WHERE singleton = 1 AND operation_id = ?').bind(successor.player_id, operationId)
        ] : []),
        ...promotionGifts
      ]);
      removed = results[1]?.results?.[0];
    } else {
      removed = await env.DB.prepare(`DELETE FROM ${adminTable(registration)} WHERE singleton = 1 AND player_id = ? AND claimed_at = ? RETURNING player_id`).bind(player.id, expected.claimedAt).first();
    }
    if (!removed) fail(409, 'ADMIN_REGISTRATION_CHANGED', '運営登録が変更されています。最新の状態を確認してください。');
    // Keep player identities, configuration and delivered gifts intact.
    const remaining = await adminRecord(env, player.id);
    return {released:true, player:playerView({...player, is_admin:remaining?.singleton}), ...await adminState(env, request)};
  }
  if (path === '/api/admin/config' && method === 'PUT') {
    const body = await bodyJSON(request), config = validateConfig(body.config), current = await configRecord(env);
    if (body.expectedRevision !== undefined && body.expectedRevision !== current.revision) fail(409, 'CONFIG_CHANGED', '設定が変更されています。再読み込みしてください。');
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE futo_config SET config_json = ?, revision = revision + 1, updated_at = ? WHERE singleton = 1 AND revision = ? AND EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND claimed_at = ?) RETURNING revision').bind(JSON.stringify(config), Date.now(), current.revision, player.id, registration.claimed_at),
      env.DB.prepare("UPDATE grants SET config_json = (SELECT config_json FROM futo_config WHERE singleton = 1) WHERE grant_id = 'admin-initial:' || player_id AND EXISTS (SELECT 1 FROM admin_members a WHERE a.player_id = grants.player_id AND a.singleton IN (1,3)) AND EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND claimed_at = ?)").bind(player.id, registration.claimed_at)
    ]);
    const result = results[0]?.results?.[0];
    if (!result) { await requireAdmin(env, player); fail(409, 'CONFIG_CHANGED', '設定が変更されています。再読み込みしてください。'); }
    return {config, revision:result.revision};
  }
  if (path === '/api/admin/players' && method === 'GET') {
    const {cursor, limit} = paging(url);
    const result = await env.DB.prepare('SELECT p.row_id, p.id, p.name, p.created_at, (SELECT a.singleton FROM admin_members a WHERE a.player_id=p.id) AS is_admin FROM players p WHERE p.row_id > ? ORDER BY p.row_id LIMIT ?').bind(cursor, limit + 1).all();
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
      env.DB.prepare('INSERT OR IGNORE INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) SELECT ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(row_id), 0) FROM players), ? WHERE EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND claimed_at = ?)').bind(batchId, player.id, target, payloadHash, configJSON, Date.now(), player.id, registration.claimed_at),
      env.DB.prepare("INSERT OR IGNORE INTO grants (grant_id, batch_id, player_id, config_json, created_at) SELECT b.id || ':' || p.id, b.id, p.id, b.config_json, b.created_at FROM grant_batches b JOIN players p ON p.row_id <= b.max_player_row AND (b.target = 'all' OR b.target = p.id) WHERE b.id = ? AND b.payload_hash = ? AND b.creator_id = ? AND EXISTS (SELECT 1 FROM admin_members WHERE player_id = ? AND claimed_at = ?)").bind(batchId, storedHash, player.id, player.id, registration.claimed_at)
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
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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
