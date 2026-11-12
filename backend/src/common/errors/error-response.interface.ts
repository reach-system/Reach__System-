export interface ErrorResponseDto {
  message: string;
  code: string;
  statusCode: number;
  /**
   * Extra, non-sensitive context attached by the throw site (for example
   * `productName`, `available`, `requested` for INSUFFICIENT_STOCK). Clients
   * use these fields to render a specific message instead of a generic one.
   */
  [key: string]: unknown;
}
