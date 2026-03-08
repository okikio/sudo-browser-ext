import type { PlasmoMessaging } from '@plasmohq/messaging';

import { hasDomainPermission, hasPermission } from '~hooks/usePermission';
import { getVersion } from '~hooks/useVersion';
import type { BaseRequest } from '~types/request';
import type { BaseResponse } from '~types/response';
import { makeUrlIntoDomain } from '~utils/domains';
import { isDomainWhitelisted } from '~utils/storage';

type Response = BaseResponse<{
  version: string;
  allowed: boolean;
  hasPermission: boolean;
  domainPermission: boolean;
}>;

const handler: PlasmoMessaging.MessageHandler<BaseRequest, Response> = async (req, res) => {
  try {
    if (!req.sender?.tab?.url) throw new Error('No tab URL found in the request.');

    const version = getVersion();
    const domain = makeUrlIntoDomain(req.sender.tab.url);

    res.send({
      success: true,
      version,
      allowed: await isDomainWhitelisted(req.sender.tab.url),
      hasPermission: await hasPermission(),
      domainPermission: domain ? await hasDomainPermission(domain) : false,
    });
  } catch (err) {
    res.send({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export default handler;
