'use strict'

const braveDbLib = require('../db')
const braveDebugLib = require('../debug')
const braveS3Lib = require('../s3')
const braveValidationLib = require('../validation')

/**
 * @file
 * Lambda action for building slim list from the data recorded in the database.
 */

/**
 * Check whether the given invocation arguments for the lambda are valid,
 * and return a version of them that are valid, after doing things like
 * filling in optional arguments, etc.
 *
 * Optional arguments
 *  - max {int}
 *      The maximum number of rules to return when building slim list. Defaults
 *      to 5,000
 *  - days {int}
 *      The maximum number of days backward to look when deciding which rules
 *      to include in slim list. Defaults to 14
 *  - s3Bucket {string}
 *      The S3 bucket to record slim list into. Defaults to
 *      `com.brave.research.slim-list`
 *  - s3Key {string}
 *      The S3 key to write slim list to.  Defaults to `slim-list/<date>.json`
 *
 * @return [bool, object|string]
 *   Returns either false, and then a string describing the error in the
 *   arguments, or true, and a frozen object with arguments prepared for
 *   operating on.
 */
const validateArgs = async inputArgs => {
  const isString = braveValidationLib.ofTypeAndTruthy.bind(undefined, 'string')
  const validationRules = {
    max: {
      validate: braveValidationLib.isPositiveNumber,
      default: 5000
    },
    days: {
      validate: braveValidationLib.isPositiveNumber,
      default: 14
    },
    s3Bucket: {
      validate: isString,
      default: 'com.brave.research.slim-list'
    },
    s3Key: {
      validate: isString,
      default: `slim-list/${(new Date()).toISOString()}.json`
    }
  }

  const [isValid, msg] = braveValidationLib.applyValidationRules(
    inputArgs, validationRules)

  if (isValid === false) {
    return [false, msg]
  }

  return [true, Object.freeze(msg)]
}

/**
 * Lambda function to build slim-list, off existing crawl data.
 */
const start = async args => {
  const msAgo = (args.days * 1000 * 60 * 60 * 24)
  const earliestBatchToConsider = (new Date(Date.now() - msAgo)).toISOString()

  const maxRules = args.max

  braveDebugLib.log(`About to query for up to ${maxRules} rules used in the last ${args.days} days`)
  const dbClient = await braveDbLib.getClient()
  const exceptionRules = await braveDbLib.popularExceptionRules(dbClient, earliestBatchToConsider, maxRules)
  const numExceptionRules = exceptionRules.length
  braveDebugLib.log(`Found ${numExceptionRules} recently used exception rules`)

  const maxBlockingRules = maxRules - numExceptionRules
  const blockingRules = await braveDbLib.popularBlockingRules(dbClient, earliestBatchToConsider, maxBlockingRules)
  braveDebugLib.log(`Found ${blockingRules.length} recently used exception rules`)

  const combinedRules = exceptionRules.concat(blockingRules)

  braveDebugLib.log(`Saving slim-list with ${combinedRules.length} rules`)
  const rulesJSON = JSON.stringify(combinedRules)

  const read_acl = 'uri="http://acs.amazonaws.com/groups/global/AllUsers"'
  const full_control_acl = 'id="08d9d664ad099538106571744f55ac449c1eb8dc08c08c114039011d43395954"'
  await braveS3Lib.write(args.s3Bucket, args.s3Key, rulesJSON, read_acl, full_control_acl)
  await braveS3Lib.write(args.s3Bucket, 'slim-list/latest.json', rulesJSON, read_acl, full_control_acl)
}

module.exports = {
  validateArgs,
  start
}
