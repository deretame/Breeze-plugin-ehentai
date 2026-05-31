import type { InfoContract } from "../../types/type";
import { mapInfo } from "../mappers/info.mapper";

export function getInfoService(): InfoContract {
  return mapInfo();
}
