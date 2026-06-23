import { LEVEL_LEN } from '../core/constants';
import type { Planet } from '../core/types';

// Moon bonus levels. A Moon is the same shape as a Planet (so it plugs straight
// into the level interpreter) plus a parent-planet index and an id/sticker.
// Reached from the Galaxy Map under its parent; completing one awards a sticker.
// Mercury and Venus have no moon (a fact in itself!).
export interface Moon extends Planet {
  id: string;
  parent: number; // index into PLANETS
  sticker: string;
}

export const MOONS: Moon[] = [
  { id:'moon-earth', parent:2, sticker:'moon-earth', name:'The Moon',
    sky:[0x0c0e16,0x3a3f4a], ground:0x9a9aa2, hill:0x6e6e78, char:0xa8e0ff, dust:0xcfd2da, enemy:0x8a8a96, grav:0.016, jump:0.60,
    emoji:'🌙', fact:"Our Moon is Earth's only natural satellite!",
    facts:["The Moon has no air, so its sky is always black!","The Moon is covered in dusty craters!","Astronauts have walked on the Moon!","The Moon helps make the ocean tides!","Footprints on the Moon can last for ages!"],
    dyn:{ craters:true },
    terrain:{ type:'horizontal', shape:'dunes',
      platforms:[[-28,2.2],[-12,1.8],[4,2.4],[20,2.0],[32,2.6]],
      mesas:[[-LEVEL_LEN/2+20,0.7]] } },

  { id:'moon-mars', parent:3, sticker:'moon-mars', name:'Phobos',
    sky:[0x2a1a14,0x6e4030], ground:0x7a5a4a, hill:0x5a4030, char:0xa8e0ff, dust:0xb08a6a, enemy:0x8a6a4a, grav:0.010, jump:0.60,
    emoji:'🥔', fact:"Phobos is Mars's tiny potato-shaped moon!",
    facts:["Phobos is so small you'd feel super light!","Phobos zooms around Mars very fast!","Phobos is lumpy like a potato!","Phobos has a giant crater named Stickney!","Phobos drifts a little closer to Mars each year!"],
    dyn:{ rocks:[-22,-3,18] },
    terrain:{ type:'horizontal', shape:'flat',
      platforms:[[-30,2.0],[-14,2.6],[2,2.2],[18,2.8],[32,2.2]] } },

  { id:'moon-jupiter', parent:4, sticker:'moon-jupiter', name:'Europa',
    sky:[0x20242e,0x7a86a0], ground:0xcfe0ef, hill:0x9ab0c8, char:0xa8e0ff, dust:0xeaf4ff, enemy:0x8fb0d0, grav:0.018, jump:0.57,
    emoji:'🧊', fact:"Europa is Jupiter's icy moon with an ocean under the ice!",
    facts:["Europa is covered in smooth, shiny ice!","Deep under Europa's ice is a hidden ocean!","Europa is one of Jupiter's big moons!","Europa has long cracks across its ice!","Europa is one of the smoothest worlds we know!"],
    dyn:{ slippery:true, ice:[[-24,4],[-2,5],[20,4]], frost:true },
    terrain:{ type:'horizontal', shape:'flat',
      platforms:[[-30,2.2],[-12,2.8],[6,2.2],[24,2.6]] } },

  { id:'moon-saturn', parent:5, sticker:'moon-saturn', name:'Titan',
    sky:[0x3a2a10,0xc89850], ground:0xb88a4a, hill:0x8a6630, char:0xa8e0ff, dust:0xe0b070, enemy:0xc89850, grav:0.014, jump:0.58,
    emoji:'🟠', fact:"Titan is Saturn's biggest moon, with a thick orange sky!",
    facts:["Titan has a thick, hazy orange sky!","Titan has rivers and lakes — but not of water!","Titan is bigger than the planet Mercury!","Titan is Saturn's largest moon!","Titan's rain is not made of water!"],
    dyn:{ wind:{zones:[[-26,-14],[2,14],[24,34]], strength:0.04, color:0xe0b070} },
    terrain:{ type:'horizontal', shape:'hills',
      platforms:[[-30,2.0],[-18,2.8],[-4,2.2],[14,2.6],[30,2.2]] } },

  { id:'moon-uranus', parent:6, sticker:'moon-uranus', name:'Titania',
    sky:[0x16323a,0x6fb0b8], ground:0x86c0c8, hill:0x5f9098, char:0xa8e0ff, dust:0xd6ffff, enemy:0x6fb0b8, grav:0.015, jump:0.57,
    emoji:'❄️', fact:"Titania is the biggest moon of Uranus — icy and cold!",
    facts:["Titania is Uranus's largest moon!","Titania is made of ice and rock!","Titania has huge deep canyons!","Titania is very, very cold!","Titania was discovered over 200 years ago!"],
    dyn:{ frost:true, ice:[[-22,5],[6,5]] },
    terrain:{ type:'horizontal', shape:'flat',
      platforms:[[-28,2.4],[-10,2.0],[8,2.6],[26,2.2]] } },

  { id:'moon-neptune', parent:7, sticker:'moon-neptune', name:'Triton',
    sky:[0x101a3a,0x5a7fc0], ground:0x6a8fd0, hill:0x40559a, char:0xa8e0ff, dust:0xcadcff, enemy:0x5a7fc0, grav:0.013, jump:0.59,
    emoji:'💧', fact:"Triton is Neptune's big moon with chilly icy geysers!",
    facts:["Triton shoots icy geysers up high!","Triton orbits Neptune backwards!","Triton is one of the coldest places we know!","Triton may have come from far away!","Triton has a pinkish icy surface!"],
    dyn:{ geysers:[-16,4,22], bubbles:[-10,8,24] },
    terrain:{ type:'horizontal', shape:'trench',
      steps:[[-LEVEL_LEN/2,-26,0],[-26,-12,-1.0],[-12,4,0],[4,18,-0.8],[18,34,1.0],[34,LEVEL_LEN/2,0]],
      platforms:[[-20,2.4],[-4,2.0],[10,2.6],[26,2.8]] } },
];

export function moonForPlanet(i: number): Moon | undefined { return MOONS.find(m => m.parent === i); }
export function moonById(id: string): Moon | undefined { return MOONS.find(m => m.id === id); }
