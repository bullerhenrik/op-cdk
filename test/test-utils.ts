import { Stack } from "aws-cdk-lib"
import { Vpc, SubnetType, IpAddresses } from "aws-cdk-lib/aws-ec2"

/**
 * Builds a VPC for testing purposes.
 * @param stack - The CDK Stack where the VPC will be defined.
 * @returns The created VPC.
 */
export function buildVpc(stack: Stack): Vpc {
  return new Vpc(stack, "TestVpc", {
    maxAzs: 2,
    ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
    subnetConfiguration: [
      {
        cidrMask: 24,
        name: "PublicSubnet",
        subnetType: SubnetType.PUBLIC,
      },
      {
        cidrMask: 24,
        name: "PrivateSubnet",
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      {
        cidrMask: 24,
        name: "IsolatedSubnet",
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    ],
  })
}
