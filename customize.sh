#!/bin/bash
docker-compose exec thelounge sh -c 'echo "#connect > form > div:nth-child(4), #connect > form > div:nth-child(6), #footer > span:nth-child(3), #connect > form > div:nth-child(5),  #connect > form > div:nth-child(7) { display: none; } sidebar .logo, #sidebar .logo-inverted { -webkit-filter: invert(100%); filter: invert(100%); }" >> /usr/local/share/.config/yarn/global/node_modules/thelounge/public/css/style.css'
docker-compose exec thelounge sh -c 'sed -i "s/The Lounge - https:\/\/thelounge.chat/Always listening to dnbradio - https:\/\/dnbradio.com\/player/g" /usr/local/share/.config/yarn/global/node_modules/thelounge/public/js/bundle.js'


docker-compose exec thelounge sh -c 'sed -i "s/e._v(\"Nick\")/e._v(\"Enter an Alias\")/g" /usr/local/share/.config/yarn/global/node_modules/thelounge/public/js/bundle.js'
