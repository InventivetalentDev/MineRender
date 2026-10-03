import { SkinPart } from "./SkinPart";
import { TripleArray } from "../model/Model";
import merge from "ts-deepmerge";

export type SkinGeometries = Record<SkinPart, TripleArray>;

const box8inner: TripleArray = [8, 8, 8];
const box8outer: TripleArray = [8.504, 8.504, 8.504];

const box8_12_4inner: TripleArray = [8, 12, 4];
const box8_12_4outer: TripleArray = [8.504, 12.504, 4.504];

const box4_12_4inner: TripleArray = [4, 12, 4];
const box4_12_4outer: TripleArray = [4.504, 12.504, 4.504];

const box3_12_4inner: TripleArray = [3, 12, 4];
const box3_12_4outer: TripleArray = [3.504, 12.504, 4.504];

const box4_12_3inner: TripleArray = [4, 12, 3];
const box4_12_3outer: TripleArray = [4.504, 12.504, 3.504];

const box10_16_1: TripleArray = [10, 16, 1];

const baseSkinGeometries: SkinGeometries = {
    head: box8inner,
    hat: box8outer,

    body: box8_12_4inner,
    jacket: box8_12_4outer,

    leftArm: box4_12_4inner,
    leftSleeve: box4_12_4outer,

    rightArm: box4_12_4inner,
    rightSleeve: box4_12_4outer,

    leftLeg: box4_12_4inner,
    leftTrousers: box4_12_4outer,

    rightLeg: box4_12_4inner,
    rightTrousers: box4_12_4outer,

    cape: box10_16_1
}

export const classicSkinGeometries: SkinGeometries = {...{}, ...baseSkinGeometries};
export const slimSkinGeometries: SkinGeometries = {
    ...{}, ...baseSkinGeometries, ...{
        leftArm: box3_12_4inner,
        leftSleeve: box3_12_4outer,

        rightArm: box3_12_4inner,
        rightSleeve: box3_12_4outer,
    }
};
