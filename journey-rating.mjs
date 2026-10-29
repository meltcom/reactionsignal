export function ratingMarkup(average,count){
 const value=Number(average),n=Number(count);if(!Number.isFinite(value)||value<1||value>5||!Number.isSafeInteger(n)||n<1)return '';
 return `<span class="journey-rating" aria-label="${value.toFixed(1)} out of 5 stars, ${n} rating${n===1?'':'s'}"><span class="journey-stars" aria-hidden="true"><span>★★★★★</span><span class="journey-stars-fill" style="width:${Number((value*20).toFixed(4))}%">★★★★★</span></span><span aria-hidden="true">${value.toFixed(1)} · ${n} rating${n===1?'':'s'}</span></span>`;
}
