import type { InfoContract } from "breeze-plugin-kit";
import { mapInfo } from "../mappers/info.mapper";

export function getInfoService(): InfoContract {
  return mapInfo();
}
