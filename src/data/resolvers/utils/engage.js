import requestify from 'requestify';

import { Users, Integrations, EngageMessages, Conversations, Messages } from '../../../db/models';

/*
 * replaces customer & user infos in given content
 * @return String
 */
export const replaceKeys = ({ content, customer, user }) => {
  let result = content;

  // replace customer fields
  result = result.replace(/{{\s?customer.name\s?}}/gi, customer.name);
  result = result.replace(/{{\s?customer.email\s?}}/gi, customer.email);

  // replace user fields
  result = result.replace(/{{\s?user.fullName\s?}}/gi, user.fullName);
  result = result.replace(/{{\s?user.position\s?}}/gi, user.position);
  result = result.replace(/{{\s?user.email\s?}}/gi, user.email);

  return result;
};

/*
 * returns requested user's ip address
 */
const getIP = remoteAddress => {
  if (process.env.NODE_ENV === 'production') {
    return Promise.resolve(remoteAddress);
  }

  return requestify.get('https://jsonip.com').then(res => JSON.parse(res.body).ip);
};

/*
 * returns requested user's geolocation info
 */
const getLocationInfo = remoteAddress => {
  // Don't do anything in test mode
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve({
      city: 'Ulaanbaatar',
      country: 'Mongolia',
    });
  }

  return getIP(remoteAddress).then(ip =>
    requestify.get(`http://ipinfo.io/${ip}/json`).then(response => {
      const data = JSON.parse(response.body);

      return {
        city: data.city,
        country: data.country,
      };
    }),
  );
};

/*
 * checks individual rule
 * @return boolean
 */
export const checkRule = ({ rule, browserInfo, numberOfVisits, city, country }) => {
  const { language, url } = browserInfo;
  const { kind, condition } = rule;
  const ruleValue = rule.value;

  let valueToTest;

  if (kind === 'browserLanguage') {
    valueToTest = language;
  }

  if (kind === 'currentPageUrl') {
    valueToTest = url;
  }

  if (kind === 'city') {
    valueToTest = city;
  }

  if (kind === 'country') {
    valueToTest = country;
  }

  if (kind === 'numberOfVisits') {
    valueToTest = numberOfVisits;
  }

  // is
  if (condition === 'is' && valueToTest !== ruleValue) {
    return false;
  }

  // isNot
  if (condition === 'isNot' && valueToTest === ruleValue) {
    return false;
  }

  // isUnknown
  if (condition === 'isUnknown' && valueToTest) {
    return false;
  }

  // hasAnyValue
  if (condition === 'hasAnyValue' && !valueToTest) {
    return false;
  }

  // startsWith
  if (condition === 'startsWith' && !valueToTest.startsWith(ruleValue)) {
    return false;
  }

  // endsWith
  if (condition === 'endsWith' && !valueToTest.endsWith(ruleValue)) {
    return false;
  }

  // greaterThan
  if (condition === 'greaterThan' && valueToTest < ruleValue) {
    return false;
  }

  // lessThan
  if (condition === 'lessThan' && valueToTest > ruleValue) {
    return false;
  }

  return true;
};

/*
 * this function determines whether or not current visitor's information
 * satisfying given engage message's rules
 * @return Promise
 */
export const checkRules = ({ rules, browserInfo, numberOfVisits, remoteAddress }) =>
  // get country, city info
  getLocationInfo(remoteAddress)
    .then(({ city, country }) => {
      let passedAllRules = true;

      rules.forEach(rule => {
        // check individual rule
        if (!checkRule({ rule, browserInfo, city, country, numberOfVisits })) {
          passedAllRules = false;
          return;
        }
      });

      return passedAllRules;
    })
    .catch(e => {
      console.log(e); // eslint-disable-line
    });

/*
 * Creates conversation & message object using given info
 * @return Promise
 */
export const createConversation = ({ customer, integration, user, engageData }) => {
  // replace keys in content
  const replacedContent = replaceKeys({
    content: engageData.content,
    customer: customer,
    user,
  });

  let conversation;

  // create conversation
  return (
    Conversations.createConversation({
      userId: user._id,
      customerId: customer._id,
      integrationId: integration._id,
      content: replacedContent,
    })
      // create message
      .then(_conversation => {
        conversation = _conversation;

        return Messages.createMessage({
          engageData,
          conversationId: _conversation._id,
          userId: user._id,
          customerId: customer._id,
          content: replacedContent,
        });
      })
      .then(message => ({
        message,
        conversation,
      }))
      // catch exception
      .catch(error => {
        console.log(error); // eslint-disable-line no-console
      })
  );
};

/*
 * this function will be used in messagerConnect and it will create conversations
 * when visitor messenger connect * @return Promise
 */

export const createEngageVisitorMessages = ({
  brandCode,
  customer,
  integration,
  browserInfo,
  remoteAddress,
}) =>
  Integrations.getIntegration(brandCode, 'messenger', true)
    // find engage messages
    .then(({ brand, integration }) => {
      const messengerData = integration.messengerData || {};

      // if integration configured as hide conversations
      // then do not create any engage messages
      if (messengerData.hideConversationList) {
        return Promise.resolve([]);
      }

      return EngageMessages.find({
        'messenger.brandId': brand._id,
        kind: 'visitorAuto',
        method: 'messenger',
        isLive: true,
        customerIds: { $nin: [customer._id] },
      });
    })
    .then(messages => {
      const results = [];

      messages.forEach(message => {
        const result = Users.findOne({ _id: message.fromUserId }).then(user =>
          // check for rules
          checkRules({
            rules: message.messenger.rules,
            browserInfo,
            remoteAddress,
            numberOfVisits: customer.messengerData.sessionCount || 0,
          }).then(isPassedAllRules => {
            // if given visitor is matched with given condition then create
            // conversations
            if (isPassedAllRules) {
              return (
                createConversation({
                  customer,
                  integration,
                  user,
                  engageData: {
                    ...message.messenger,
                    messageId: message._id,
                    fromUserId: message.fromUserId,
                  },
                })
                  // add given customer to customerIds list
                  .then(() =>
                    EngageMessages.update(
                      { _id: message._id },
                      { $push: { customerIds: customer._id } },
                      {},
                      () => {},
                    ),
                  )
              );
            }
          }),
        );

        results.push(result);
      });

      return Promise.all(results);
    })
    // catch exception
    .catch(error => {
      console.log(error); // eslint-disable-line no-console
    });
