#!/bin/bash
# Creates S3 + ACM + CloudFront + Route53 for hacktx26.alanroybal.com. Idempotent-ish; logs to ~/hacktx26-infra.log
set -e
export AWS_DEFAULT_REGION=us-east-1 AWS_PAGER=""
B=hacktx26-alanroybal-clips; D=hacktx26.alanroybal.com; Z=Z07049721TYQIC9PL1LZO
aws s3api head-bucket --bucket $B 2>/dev/null || aws s3api create-bucket --bucket $B
aws s3api put-public-access-block --bucket $B --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
CERT=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='$D'].CertificateArn | [0]" --output text)
if [ "$CERT" = "None" ] || [ -z "$CERT" ]; then CERT=$(aws acm request-certificate --domain-name $D --validation-method DNS --query CertificateArn --output text); sleep 15; fi
echo "CERT $CERT"
RN=$(aws acm describe-certificate --certificate-arn $CERT --query "Certificate.DomainValidationOptions[0].ResourceRecord.Name" --output text)
RV=$(aws acm describe-certificate --certificate-arn $CERT --query "Certificate.DomainValidationOptions[0].ResourceRecord.Value" --output text)
aws route53 change-resource-record-sets --hosted-zone-id $Z --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$RN\",\"Type\":\"CNAME\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$RV\"}]}}]}" >/dev/null
echo "waiting for cert"; aws acm wait certificate-validated --certificate-arn $CERT; echo "cert ok"
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items[0]=='$D'].Id | [0]" --output text)
if [ "$DIST" = "None" ] || [ -z "$DIST" ]; then
  OAC=$(aws cloudfront create-origin-access-control --origin-access-control-config "Name=$B-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" --query OriginAccessControl.Id --output text)
  cat > /tmp/hx-dist.json <<J
{"CallerReference":"hx26-$(date +%s)","Aliases":{"Quantity":1,"Items":["$D"]},"DefaultRootObject":"index.html","Comment":"HackTX26 Red River QB clips",
 "Origins":{"Quantity":1,"Items":[{"Id":"s3","DomainName":"$B.s3.us-east-1.amazonaws.com","OriginAccessControlId":"$OAC","S3OriginConfig":{"OriginAccessIdentity":""}}]},
 "DefaultCacheBehavior":{"TargetOriginId":"s3","ViewerProtocolPolicy":"redirect-to-https","CachePolicyId":"658327ea-f89d-4fab-a63d-7e88639e58f6","Compress":true,
   "AllowedMethods":{"Quantity":2,"Items":["GET","HEAD"],"CachedMethods":{"Quantity":2,"Items":["GET","HEAD"]}}},
 "ViewerCertificate":{"ACMCertificateArn":"$CERT","SSLSupportMethod":"sni-only","MinimumProtocolVersion":"TLSv1.2_2021"},
 "Enabled":true,"PriceClass":"PriceClass_100","HttpVersion":"http2and3"}
J
  DIST=$(aws cloudfront create-distribution --distribution-config file:///tmp/hx-dist.json --query Distribution.Id --output text)
fi
ACCT=$(aws sts get-caller-identity --query Account --output text)
DDOM=$(aws cloudfront get-distribution --id $DIST --query Distribution.DomainName --output text)
echo "DIST $DIST $DDOM"
aws s3api put-bucket-policy --bucket $B --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$B/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::$ACCT:distribution/$DIST\"}}}]}"
aws route53 change-resource-record-sets --hosted-zone-id $Z --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$D\",\"Type\":\"A\",\"AliasTarget\":{\"HostedZoneId\":\"Z2FDTNDATAQYW2\",\"DNSName\":\"$DDOM\",\"EvaluateTargetHealth\":false}}},{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$D\",\"Type\":\"AAAA\",\"AliasTarget\":{\"HostedZoneId\":\"Z2FDTNDATAQYW2\",\"DNSName\":\"$DDOM\",\"EvaluateTargetHealth\":false}}}]}" >/dev/null
DIR="$(cd "$(dirname "$0")/.." && pwd)"
aws s3 cp "$DIR/site/index.html" s3://$B/index.html --content-type text/html --cache-control "max-age=60"
echo "DONE"
