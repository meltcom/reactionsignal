// Explicit exceptions derived from the 20 latest discovery/classification approvals
// inspected on 2026-10-11. A channel's exception applies only to Missioned Souls.
export const approvalRules = {
 'UC0qyV-hguga2atlaoL0l2Ag': {titleOnly:true,evidence:['QxVNJ3Epo3g']},
 'UC8ReQVU4PPfbxRy4B18jauw': {titleOnly:true,evidence:['gXWQQNUpKcA']},
 'UCIVmJPriTtfAjpY2AM5i0hw': {shorts:true,unknownDuration:true,evidence:['XoLczVWaFuA','CJ0ctECQp9U','T6IZuZm2fks','sTcaFMYYNyY','Th8TDA8M7aY']},
 'UCKboltkZSCKZ0olDaaf9ECQ': {unknownDuration:true,evidence:['CFrrUE-64o8']},
 'UCKl8gsoikwaVY8MwERSy8yg': {titleOnly:true,evidence:['yX61f3ge5ns']},
 'UCP-kGozEU2blvmzI8jNCoKg': {titleOnly:true,unknownDuration:true,evidence:['F5j2XDkDzP8','8SFViMy65Qk']},
 'UC_3I7veV34l3nDT-Lef37Lw': {titleOnly:true,evidence:['DfT9qA8jJ_o']},
 'UCeAf_CPDRtxc_-UPmqzC4Aw': {titleOnly:true,evidence:['ulfT9D-MK04']},
 'UCeTfwcnUVurw7Qrk_KF5Idw': {titleOnly:true,evidence:['rzJOsZWnHqc','n_9NaBba7lg']},
 'UCfcKbuwj7AwMh1KBVxvHF7w': {unknownDuration:true,evidence:['Oomg44OmgBQ']},
 'UCiE7yuTtYGtVWRvgLGy3_tQ': {unknownDuration:true,evidence:['vZGkYeDkvyg']},
 'UCncayz8bF4ZFRaY0Oq0WRww': {unknownDuration:true,evidence:['OJHeQEqgbmo']},
 'UCz-hLsF25Xu8ILLo9twh-9g': {titleOnly:true,evidence:['KnpO-ieAVaM','OmuaV0n0RaU']}
};
export const reactionWording = title => /\b(reacts?|reactions?|reacting)\b/i.test(title);
export const explicitShort = title => /#shorts?\b/i.test(title);
export function approvedPattern(title,duration,{performerId,channelId}={}) {
 const rule=performerId==='missioned-souls'?approvalRules[channelId]:null;
 if(!rule)return false;
 if(duration===null&&!rule.unknownDuration)return false;
 if(duration!==null&&duration<=180||explicitShort(title))return !!rule.shorts&&reactionWording(title)&&(duration===null||duration<=180);
 return reactionWording(title)||!!rule.titleOnly;
}
